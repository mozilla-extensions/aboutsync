"use strict";
// Providers for the data used by the addon.
// Data can be provided by Sync itself, or by a JSON file.

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
const { importLocal } = require("./common");
const { PrefCheckbox } = require("./config");

const { Weave } = importLocal("resource://services-sync/main.js");

const { CryptoWrapper, Collection } = importLocal("resource://services-sync/record.js");
const { OS } = importLocal("resource://gre/modules/osfile.jsm");
const { PlacesUtils } = importLocal("resource://gre/modules/PlacesUtils.jsm");
const { Services } = importLocal("resource://gre/modules/Services.jsm");

const React = require("react");

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

  get isLocal() {
    return this.type == "local";
  }
}

class JSONProvider extends Provider {
  constructor(url) {
    super("json");
    this._loadPromise = fetch(url).then(resp => resp.json());
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
      this._info = (async () => {
        let info = await Weave.Service._fetchInfo();
        const collCountURL = Weave.Service.userBaseURL + "info/collection_counts";
        let collectionCounts = (await Weave.Service._fetchInfo(collCountURL)).obj;
        let result = { status: info.status, collections: [], collectionCounts };
        for (let name of Object.keys(info.obj).sort()) {
          let lastModified = new Date(+info.obj[name] * 1000);
          let url = Weave.Service.storageURL + name;
          let collectionInfo = { name, lastModified, url };
          result.collections.push(collectionInfo);
          // and kick off the fetch of the collection.
          this.promiseCollection(collectionInfo);
        }
        return result;
      })();
    }
    return this._info.then(result => clone(result));
  }

  get limitHistoryFetch() {
    return Services.prefs.getBoolPref("extensions.aboutsync.limitHistoryFetch", true);
  }

  promiseCollection(info) {
    if (!this._collections[info.name]) {
      let collection = new Collection(info.url, CryptoWrapper, Weave.Service);
      collection.full = true;
      if (info.name == "history" && this.limitHistoryFetch) {
        // Hacky, but downloading all history makes everything so hard to use...
        collection.limit = 5000;
        collection.sort = "index";
      }
      let records = [];
      let rawRecords = [];
      let key = Weave.Service.collectionKeys.keyForCollection(info.name);
      let recordHandler = async record => {
        rawRecords.push(record);
        if (info.name == "crypto") {
          // We need to decrypt the crypto collection itself with the key bundle.
          await record.decrypt(Weave.Service.identity.syncKeyBundle);
          records.push(record.cleartext);
        } else {
          // All others are decrypted with a key that may be per-collection
          // (unless there's no ciphertext, in which case there's no decryption
          // necessary - which is currently just the "meta" collection)
          if (record.ciphertext) {
            await record.decrypt(key);
            records.push(record.cleartext);
          } else {
            records.push(record.payload);
          }
        }
      }
      // For some reason I can't get Object.getOwnPropertyDescriptor(collection, "recordHandler")
      // to tell us if bug 1370985 has landed - so just do it a very hacky
      // way - we always set .recordHandler and sniff the result to see if
      // it was actually called or not.
      collection.recordHandler = recordHandler;

      let doFetch = async function() {
        let result = await collection.getBatched();
        let httpresponse;
        if (result.response) {
          // OK - bug 1370985 has landed.
          httpresponse = result.response;
          let records = result.records;
          result.records = [];
          for (let record of records) {
            result.records.push(await recordHandler(record));
          }
        } else {
          // Pre bug 1370985, so the record handler has already been called.
          httpresponse = result;
        }
        // turn it into a vanilla object.
        let response = {
          url: httpresponse.url,
          status: httpresponse.status,
          success: httpresponse.success,
          headers: httpresponse.headers,
          records: rawRecords,
        };
        return { response, records };
      }
      this._collections[info.name] = doFetch();
    }
    return this._collections[info.name].then(result => clone(result));
  }

  promiseBookmarksTree() {
    return PlacesUtils.promiseBookmarksTree("", {
      includeItemIds: true
    }).then(result => clone(result));
  }

  async promiseExport(path, anonymize = true, collections = ["bookmarks"]) {
    // We need to wait for all collections to complete.
    let infos = await this.promiseCollectionInfo();
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
      ob.bookmarksTree = await this.promiseBookmarksTree();
    }
    for (let info of infos.collections) {
      let got = await this.promiseCollection(info);
      ob.collections[info.name] = got;
    }
    if (anonymize) {
      this.anonymize(ob);
    }
    let json = JSON.stringify(ob, undefined, 2); // pretty!
    return OS.File.writeAtomic(path, json, {encoding: "utf-8", tmpPath: path + ".tmp"});
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
          let aboutParams = new URLSearchParams(aboutTrailing[0].replace(/^\?/, ""));
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

// I'm sure this is very un-react-y - I'm just not sure how it should be done.
const ProviderState = {
  newProvider() {
    if (this.useLocalProvider) {
      return new LocalProvider();
    }
    return new JSONProvider(this.url);
  },

  get useLocalProvider() {
    try {
      return Services.prefs.getBoolPref("extensions.aboutsync.localProvider");
    } catch (_) {
      return true;
    }
  },

  set useLocalProvider(should) {
    Services.prefs.setBoolPref("extensions.aboutsync.localProvider", should);
  },

  get url() {
    try {
      return Services.prefs.getCharPref("extensions.aboutsync.providerURL");
    } catch (_) {
      return "";
    }
  },

  set url(url) {
    Services.prefs.setCharPref("extensions.aboutsync.providerURL", url);
  },
}

class ProviderInfo extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      anonymize: true,
      local: ProviderState.useLocalProvider,
      url: ProviderState.url,
    };
  }

  componentWillUpdate(nextProps, nextState) {
    // XXX - This is not a good way to go about this.
    console.log(nextState);
    ProviderState.useLocalProvider = nextState.local;
    ProviderState.url = nextState.url;
  }

  render() {
    let onLocalClick = event => {
      this.setState({ local: true });
    };
    let onExportClick = () => {
      const nsIFilePicker = Ci.nsIFilePicker;
      let titleText = "Select name to export the JSON data to";
      let fp = Cc["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
      let fpCallback = result => {
        if (result == nsIFilePicker.returnOK || result == nsIFilePicker.returnReplace) {
          let filename = fp.file.QueryInterface(Ci.nsIFile).path;
          this.props.provider.promiseExport(filename, this.state.anonymize).then(() => {
            alert("File created");
          }).catch(err => {
            console.error("Failed to create file", err);
            alert("Failed to create file: " + err);
          });
        }
      }

      fp.init(window, titleText, nsIFilePicker.modeSave);
      fp.appendFilters(nsIFilePicker.filterAll);
      fp.open(fpCallback);
    };
    let onExternalClick = event => {
      this.setState({ local: false });
    };
    let onChooseClick = () => {
      const nsIFilePicker = Ci.nsIFilePicker;
      let titleText = "Select local file";
      let fp = Cc["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
      let fpCallback = result => {
        if (result == nsIFilePicker.returnOK) {
          this.setState({ url: fp.fileURL.spec })
        }
      }
      fp.init(window, titleText, nsIFilePicker.modeOpen);
      fp.appendFilters(nsIFilePicker.filterAll);
      fp.open(fpCallback);
    }
    let onInputChange = event => {
      this.setState({ url: event.target.value });
    };

    return (
      <fieldset>
        <legend>Data provider options</legend>
        <div>
          <p>
            <label className="provider">
              <input type="radio" checked={this.state.local} onChange={onLocalClick}/>
              Load local sync data
            </label>
            <span className="provider-extra" hidden={!this.state.local}>
              <PrefCheckbox label="Limit history engine fetch to first 5000 records?"
                            pref="extensions.aboutsync.limitHistoryFetch"
                            defaultValue={true}/>
              <label>
                <input type="checkbox" defaultChecked={true}
                       onChange={ev => this.setState({anonymize: ev.target.checked})}/>
                Anonymize data
              </label>
              <button onClick={onExportClick}>Export to file...</button>
            </span>
          </p>
          <p>
            <label className="provider">
              <input type="radio" checked={!this.state.local} onChange={onExternalClick}/>
              Load JSON from URL
            </label>
            <span className="provider-extra" hidden={this.state.local}>
              <input value={this.state.url} onChange={onInputChange} />
              <button onClick={onChooseClick}>Choose local file...</button>
            </span>
          </p>
        </div>
        <button onClick={() => this.props.updateProvider()}>Load</button>
      </fieldset>
    );
  }
}

module.exports = { JSONProvider, LocalProvider, ProviderState, ProviderInfo };

