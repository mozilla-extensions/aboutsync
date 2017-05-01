// Providers for the data used by the addon.
// Data can be provided by Sync itself, or by a JSON file.
let Providers = (function() {
  'use strict';

  const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

  Cu.import("resource://gre/modules/Task.jsm");
  Cu.import("resource://services-sync/record.js");
  Cu.import("resource://gre/modules/osfile.jsm");
  Cu.import("resource://gre/modules/PlacesUtils.jsm");

  // This is hacky, but after deserialize is called there's no way for us to
  // access this data, which represents the original request data, so we patch it.
  let originalDeserialize = WBORecord.prototype.deserialize;
  WBORecord.prototype.deserialize = function(json) {
    this.aboutSync_originalData = json;
    try {
      this.aboutSync_originalParsedData = JSON.parse(json);
    } catch (e) {
      // It doesn't matter, we already have the original data as a string.
    }
    return originalDeserialize.apply(this, arguments);
  };

  // We always clone the data we return as the consumer may modify it (and
  // that's a problem for our "export" functionality - we don't want to write
  // the modified data.
  function clone(data) {
    return Cu.cloneInto(data, {});
  }

  class Provider {
    constructor(type) {
      this.type = type;
    }
  }

  class JSONProvider extends Provider {
    constructor(url) {
      super("json");
      this._loadPromise = new Promise((resolve, reject) => {
        let request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.responseType = 'json';
        request.onload = () => {
          let data = request.response;
          if (data) {
            resolve(data);
          } else {
            reject("No JSON could be loaded from " + url);
          }
        }
        request.onerror = err => {
          reject("Could not load the JSON: " + err);
        }
        request.onabort = err => {
          reject("JSON load was aborted: " + err);
        }
        request.send();
      });
    }

    promiseCollectionInfo() {
      return this._loadPromise.then(data => {
        return clone(data.infos);
      });
    }

    promiseCollection(info) {
      return this._loadPromise.then(data => {
        return clone(data.collections[info.name]);
      });
    }

    promiseBookmarksTree() {
      return this._loadPromise.then(data => {
        return clone(data.bookmarksTree);
      });
    }
  }

  class LocalProvider extends Provider {
    constructor() {
      super("local");
      this._info = null;
      this._collections = {};
    }

    promiseCollectionInfo() {
      if (!this._info) {
        // Sync's nested event-loop blocking API means we should do the fetch after
        // an event spin.
        this._info = Promise.resolve().then(() => {
          let info = Weave.Service._fetchInfo();
          let result = { status: info.status, collections: [] };
          for (let name of Object.keys(info.obj).sort()) {
            let lastModified = new Date(+info.obj[name] * 1000);
            let url = Weave.Service.storageURL + name;
            let collectionInfo = { name, lastModified, url };
            result.collections.push(collectionInfo);
            // and kick off the fetch of the collection.
            this.promiseCollection(collectionInfo);
          }
          return result;
        });
      }
      return this._info.then(result => clone(result));
    }

    promiseCollection(info) {
      if (!this._collections[info.name]) {
        let collection = new Collection(info.url, CryptoWrapper, Weave.Service);
        collection.full = true;
        let records = [];
        let rawRecords = [];
        let key = Weave.Service.collectionKeys.keyForCollection(info.name);
        collection.recordHandler = record => {
          rawRecords.push(record);
          if (info.name == "crypto") {
            // We need to decrypt the crypto collection itself with the key bundle.
            record.decrypt(Weave.Service.identity.syncKeyBundle);
            records.push(record.cleartext);
          } else {
            // All others are decrypted with a key that may be per-collection
            // (unless there's no ciphertext, in which case there's no decryption
            // necessary - which is currently just the "meta" collection)
            if (record.ciphertext) {
              record.decrypt(key);
              records.push(record.cleartext);
            } else {
              records.push(record.payload);
            }
          }
        }
        // Do the actual fetch after an event spin.
        this._collections[info.name] = Promise.resolve().then(() => {
          if (typeof collection.getBatched == "function") {
            // Firefox 52+ supports download batching.
            return collection.getBatched();
          }
          return collection.get();
        }).then(raw => {
          // turn it into a vanilla object.
          let response = {
            url: raw.url,
            status: raw.status,
            success: raw.success,
            headers: raw.headers,
            records: rawRecords,
          };
          return { response, records };
        });
      }
      return this._collections[info.name].then(result => clone(result));
    }

    promiseBookmarksTree() {
      return PlacesUtils.promiseBookmarksTree("", {
        includeItemIds: true
      }).then(result => clone(result));
    }

    promiseExport(path, anonymize = true, collections = ["bookmarks"]) {
      return Task.spawn(function* () {
        // We need to wait for all collections to complete.
        let infos = yield this.promiseCollectionInfo();
        let original = infos.collections;
        infos.collections = [];
        for (let ob of original) {
          if (collections.indexOf(ob.name) >= 0) {
            infos.collections.push(ob);
          }
        }
        let ob = {
          infos: infos,
          collections: {},
        };
        if (collections.indexOf("bookmarks") >= 0) {
          ob.bookmarksTree = yield this.promiseBookmarksTree();
        }
        for (let info of infos.collections) {
          let got = yield this.promiseCollection(info);
          ob.collections[info.name] = got;
        }
        if (anonymize) {
          this.anonymize(ob);
        }
        let json = JSON.stringify(ob, undefined, 2); // pretty!
        return OS.File.writeAtomic(path, json, {encoding: "utf-8", tmpPath: path + ".tmp"});
      }.bind(this));
    }

    /* Perform a quick-and-nasty anonymization of the data. Replaces many
      strings with a generated string of form "str-nnn" where nnn is a number.
      Uses a map so the same string in different contexts always returns the
      same anonymized strings. There's special handling for URLs - each of the
      components of the URL is treated individually, so, eg:
      "http://www.somesite.com.au/foo/bar?days=7&noexpired=1" will end up as:
      "http://str-48/str-49/str-52/str-50?str-53=str-54&str-55=str-42"
      (ie, the general "shape" of the URL remains in place).

      Does NOT touch GUIDs and some annotations.
    */
    anonymize(exportData) {
      let strings = new Map();

      // Anonymize one string.
      function anonymizeString(str) {
        if (!str) {
          return str;
        }
        if (!strings.has(str)) {
          strings.set(str, strings.size);
        }
        return "str-" + strings.get(str);
      }

      // Anonymize a list of properties in an object.
      function anonymizeProperties(ob, propNames) {
        for (let propName of propNames.split(" ")) {
          if (ob[propName]) {
            ob[propName] = anonymizeString(ob[propName]);
          }
        }
      }

      // Anonymize a URL.
      function anonymizeURL(url) {
        // no need to anonymize place: URLs and they might be interesting.
        if (!url || url.startsWith("place:")) {
          return url;
        }
        let u = new URL(url);
        if (u.protocol == "about:") {
          // about: urls are special and don't have functioning path/querystrings
          // First split the about page from the query/hash:
          let aboutPage = u.pathname.match(/^[^?#\/]*/)[0];
          let aboutTrailing = u.pathname.substring(aboutPage.length).split("#");
          // The first string in the array is going to be the search query, if any.
          // Manually parse as a URLSearchParams, anonymize the params, and replace
          // the string back into the array
          if (aboutTrailing[0].length > 0) {
            let aboutParams = new URLSearchParams(aboutTrailing[0].replace(/^\?/, ''));
            anonymizeURLSearchParams(aboutParams);
            // We stripped the initial "?" - put it back:
            aboutTrailing[0] = "?" + aboutParams.toString();
          }
          // call anonymizeString on all the other bits of the array and concat
          // back into a string:
          aboutTrailing = aboutTrailing[0] + aboutTrailing.slice(1).map(anonymizeString).join("#");
          return u.protocol + aboutPage + aboutTrailing;
        }
        anonymizeProperties(u, "host username password");
        u.pathname = u.pathname.split("/").map(anonymizeString).join("/");

        if (u.hash) {
          u.hash = anonymizeString(u.hash.slice(1));
        }

        anonymizeURLSearchParams(u.searchParams);
        return u.toString();
      }

      // Anonymize a list of properties in an object as URLs
      function anonymizeURLProperties(ob, propNames) {
        for (let propName of propNames.split(" ")) {
          if (ob[propName]) {
            ob[propName] = anonymizeURL(ob[propName]);
          }
        }
      }

      // Anonymize a URL search string object
      function anonymizeURLSearchParams(searchParams) {
        // deleting items while iterating confuses things, so fetch all
        // entries as an array.
        for (let [name, value] of [...searchParams.entries()]) {
          searchParams.delete(name);
          searchParams.set(anonymizeString(name), anonymizeString(value));
        }
      }

      // A helper to walk the bookmarks tree.
      function* walkTree(node) {
        yield node;
        for (let child of (node.children || [])) {
          yield* walkTree(child);
        }
      }

      // Do the bookmark tree...
      for (let node of walkTree(exportData.bookmarksTree)) {
        anonymizeProperties(node, "title keyword");
        anonymizeURLProperties(node, "uri iconuri");
        if (node.tags) {
          node.tags = node.tags.split(",").map(anonymizeString).join(",");
        }

        if (node.annos) {
          for (let anno of node.annos) {
            switch (anno.name) {
              case "bookmarkProperties/description":
                anonymizeProperties(anno, "value");
                break;
              case "livemark/feedURI":
              case "livemark/siteURI":
                anonymizeURLProperties(anno, "value");
                break;
              default:
                // leave it alone.
            }
          }
        }
      }

      // And the server records - currently focused on bookmarks.
      for (let [collectionName, collection] of Object.entries(exportData.collections)) {
        for (let record of collection.records) {
          anonymizeProperties(record, "parentName title description keyword");
          anonymizeURLProperties(record, "bmkUri feedUri siteUri");
          if (record.tags) {
            record.tags = record.tags.map(anonymizeString);
          }
        }
      }
    }
  }
  return { JSONProvider, LocalProvider };
})();
