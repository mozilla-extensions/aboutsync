const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/FxAccounts.jsm");
Cu.import("resource://services-sync/main.js");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/PlacesUtils.jsm");

const weaveService = Cc["@mozilla.org/weave/service;1"]
                     .getService(Ci.nsISupports)
                     .wrappedJSObject;

// Returns a promise that resolves when Sync is ready and logged in.
function whenSyncReady() {
  return weaveService.whenLoaded().then(() => {
    // If we don't have a user we are screwed.
    return fxAccounts.getSignedInUser();
  }).then(userData =>  {
    if (!userData) {
      return false;
    }
    if (Weave.Service.isLoggedIn) {
      return true;
    }
    return new Promise(resolve => {
      const TOPIC = "weave:service:login:finish";
      function observe(subject, topic, data) {
        Services.obs.removeObserver(observe, TOPIC);
        resolve(true);
      }
      Services.obs.addObserver(observe, TOPIC, false);
      Weave.Service.login();
    });
  });
}

function createObjectInspector(name, data, expandLevel = 1) {
  return React.createElement(ReactInspector.ObjectInspector, {name, data, expandLevel: expandLevel });
}

function valueLookupTable(o) {
  return new Map(Object.entries(o).map(([k, v]) => [v, k]));
}

function aboutSyncCellFormatter(cellValue, isExpanded, columnName, owningRow) {
  // It would be nice if we hid form value too, but that would require threading
  // a lot of state through.
  if (!isExpanded && columnName === "password") {
    cellValue = "**** hidden unless expanded ****";
  }
  let defaultFormat = AboutSyncTableInspector.defaultProps.cellFormatter(
    cellValue, isExpanded, columnName, owningRow);
  if (columnName === "syncStatus") {
    let descs = valueLookupTable(PlacesUtils.bookmarks.SYNC_STATUS);
    if (descs.has(+cellValue)) {
      return React.DOM.span(null, defaultFormat, ` (${descs.get(+cellValue)})`);
    }
  }

  return defaultFormat;
}

function createTableInspector(data) {
  return React.createElement(AboutSyncTableInspector, {
    data,
    cellFormatter: aboutSyncCellFormatter
  });
}

function getSqlColumnNames(sql) {
  // No way to get column names from the async api :(... Bug 1326565.
  let stmt;
  try {
    const db = PlacesUtils.history.QueryInterface(Ci.nsPIPlacesDatabase).DBConnection;
    stmt = db.createStatement(sql);
    const columns = [];
    for (let i = 0; i < stmt.columnCount; ++i) {
      columns.push(stmt.getColumnName(i));
    }
    return columns;
  } finally {
    if (stmt) {
      // Do we need to call both?
      stmt.reset();
      stmt.finalize();
    }
  }
}

function promiseSql(sql, params = {}) {
  let columnNames = getSqlColumnNames(sql);
  return PlacesUtils.withConnectionWrapper(
    "AboutSync: promiseSql", Task.async(function*(db) {
    let rows = yield db.executeCached(sql, params);
    let resultRows = rows.map(row => {
      let resultRow = {};
      for (let columnName of columnNames) {
        resultRow[columnName] = row.getResultByName(columnName);
      }
      return resultRow;
    });
    return resultRows; // Return column names too?
  }));
}

// A tab-smart "anchor"
class InternalAnchor extends React.Component {
  onClick(event) {
    // Get the chrome (ie, browser) window hosting this content.
    let chromeWindow = window
         .QueryInterface(Ci.nsIInterfaceRequestor)
         .getInterface(Ci.nsIWebNavigation)
         .QueryInterface(Ci.nsIDocShellTreeItem)
         .rootTreeItem
         .QueryInterface(Ci.nsIInterfaceRequestor)
         .getInterface(Ci.nsIDOMWindow)
         .wrappedJSObject;
    chromeWindow.switchToTabHavingURI(this.props.href, true, {
      replaceQueryString: true,
      ignoreFragment: true,
    });
    event.preventDefault();
  }

  render() {
    return React.createElement("a",
                               { href: this.props.href,
                                 onClick: event => this.onClick(event),
                               },
                               this.props.children);
  }
}

// A placeholder for when we are still fetching data.
class Fetching extends React.Component {
  render() {
    return React.createElement("p", { className: "fetching" }, this.props.label);
  }
}

class AccountInfo extends React.Component {
  constructor(props) {
    super(props);
    this.state = { user: null, profile: null }
  }

  componentDidMount() {
    fxAccounts.getSignedInUser().then(data => {
      this.setState({ user: data });
      if (data) {
        fxAccounts.getSignedInUserProfile().then(profile => {
          this.setState({ profile });
        });
      }
    }).catch(Cu.reportError);
  }

  render() {
    let user = this.state.user;
    if (!user) {
      return React.createElement(Fetching, { label: "Fetching account info..." });
    }
    let avatar = [];
    let info = [];
    let raw = [];
    if (this.state.profile) {
      let profile = this.state.profile;
      avatar.push(React.createElement('img', { src: profile.avatar, className: "avatar" }));
      info.push(React.createElement('p', null, profile.displayName));
      raw.push(createObjectInspector("Full Profile", profile, 0));
    }
    info.push(React.createElement('p', null, user.email));

    return (
      React.createElement('div', null,
        React.createElement('div', { className: "profileContainer" },
          React.createElement('div', { className: "avatarContainer" }, ...avatar),
          React.createElement('div', { className: "userInfoContainer" }, ...info)
        ),
        ...raw
      )
    );
  }
}

function describeProblemList(desc, ids, map) {
  if (!ids || !ids.length) {
    return null;
  }
  return React.createElement("div", null,
    React.createElement("p", null, desc),
    createTableInspector(ids.map(id => map.get(id)))
  );
}

function describeIdFull(string, id, clientMap, serverMap) {
  // Return a few React components to render a string containing a guid.
  // Later I hope to make this an anchor and display more details, but
  // this will do for now.
  let descs = [];
  let childItem = clientMap.get(id);
  if (childItem) {
    descs.push(`Exists locally with title "${childItem.title}"`);
  } else {
    descs.push(`Does not exist locally`);
  }
  let serverItem = serverMap.get(id);
  if (serverItem) {
    descs.push(`Exists on the server with title "${serverItem.title}"`);
  } else {
    descs.push(`Does not exist on the server`);
  }
  let desc = descs.join("\n");
  let [left, right] = string.split("{id}");
  return [
    React.createElement("span", null, left),
    React.createElement("span", { className: "inline-id", title: desc }, id),
    React.createElement("span", null, right),
  ];
}

// Display validation results for subclasses of CollectionValidator that don't
// do much else.
class CollValidationResultDisplay extends React.Component {
  constructor(props) {
    super(props);
  }
  describeId(string, id) {
    return describeIdFull(string, id,
      this.props.clientMap, this.props.serverMap);
  }
  render() {
    const { p, div } = React.DOM;
    let { problems: probs, clientMap, serverMap } = this.props;
    let elems = [];
    if (probs.missingIDs) {
      elems.push(p(null, `There are ${probs.missingIDs} records without IDs`));
    }

    elems.push(describeProblemList(
      "The following server records appear on the server but not on the client.",
      probs.clientMissing, serverMap));

    elems.push(describeProblemList(
      "The following server records appear on the server but should not have been uploaded.",
      probs.serverUnexpected, serverMap));

    elems.push(describeProblemList(
      "The following records appear on the client but not on the server.",
      probs.serverMissing, clientMap));

    elems.push(describeProblemList(
      "The following records appear on the client but were marked as deleted on the server.",
      probs.serverDeleted, clientMap));

    if (probs.duplicates.length) {
      for (let dupeId of probs.duplicates) {
        let dupes = this.props.serverRecords.filter(r => r.id === dupeId);
        elems.push(div(null,
          this.describeId("The id {id} appears multiple times on the server.", dupeId),
          createTableInspector(dupes)));
      }
    }

    function diffTableEntry(id, field) {
      return {
        field,
        local: clientMap.get(id)[field],
        server: serverMap.get(id)[field]
      };
    }

    for (let { id, differences } of probs.differences) {
      let diffTable = differences.map(field => diffTableEntry(id, field))
      let desc = this.describeId("Record {id} has differences between local and server copies", id);
      elems.push(div(null,
        p(null, ...desc),
        createTableInspector(diffTable)))
    }
    elems = elems.filter(Boolean);
    if (elems.length === 0) {
      elems.push(p(null, "No validation problems found \\o/"));
    }
    return div(null, ...elems);
  }
}

const sqlQueryPref = "extensions.aboutsync.lastQuery";

function getLastQuery() {
  try {
    return Services.prefs.getCharPref(sqlQueryPref);
  } catch (e) {
    return "select * from moz_bookmarks\nlimit 100";
  }
}

function updateLastQuery(query) {
  try {
    return Services.prefs.setCharPref(sqlQueryPref, query);
  } catch (e) {
    console.warn("Failed to update last query", e);
  }
}

class PlacesSqlView extends React.Component {
  constructor() {
    super();
    this.state = {
      text: getLastQuery(),
      rows: [],
      error: null
    };
  }

  executeSql() {
    promiseSql(this.state.text).then(rows => {
      this.setState(Object.assign(this.state, { rows, error: undefined }));
      updateLastQuery(this.state.text);
    }).catch(error => {
      this.setState(Object.assign(this.state, { error }));
    })
  }

  renderErrorMsg(error) {
    if (error instanceof Ci.mozIStorageError) {
      let codeToName = valueLookupTable(Ci.mozIStorageError);
      return `mozIStorageError(${error.result}: ${codeToName.get(error.result)}): ${error.message}`;
    }
    // Be smarter here?
    return String(error);
  }

  closeError() {
    this.setState(Object.assign(this.state, { error: null }));
  }

  render() {
    const { div, button, p, textarea } = React.DOM;
    return (
      div({ className: "sql-view" },
        div({ className: "sql-editor" },
          textarea({
            value: this.state.text,
            // @@TODO: use contenteditable <pre> or something a bit nicer?
            onChange: e => {
              this.setState(Object.assign(this.state, { text: e.target.value }));
            }
          }),
          button({ className: "execute-sql", onClick: e => this.executeSql() },
            "Execute SQL")
        ),
        this.state.error && (
          div({ className: "sql-error" },
            button({ className: "close-error", onClick: e => this.closeError(), title: "Close" }, "X"),
            p(null, "Error running SQL: ", this.renderErrorMsg(this.state.error))
          )
        ),
        createTableInspector(this.state.rows)
      )
    );
  }
}

// takes an array of objects who have no real properties but have a bunch of
// getters on their prototypes, and returns an array of new objects that contain
// the properties directly. Used for XPCOM stuff. prioritizedKeys are keys
// which should be first in iteration order -- which means first in the table
// when displayed.  This probably should be doable by passing in props to
// our TableInspector...
function expandProtoGetters(arr, prioritizedKeys = []) {
  return arr.map(o => {
    let result = Object.assign({}, o);
    delete result.QueryInterface; // probably some other crap that needs to go as well...
    prioritizedKeys.forEach(k => result[k] = o[k]);
    let protoKeys = Object.keys(Object.getPrototypeOf(o));
    for (let key of protoKeys) {
      if (key in result) {
        continue;
      }
      let val = o[key];
      if (val != null && typeof val != "function") {
        result[key] = o[key];
      }
    }
    return result;
  });
}
// Functions that compute additional per-collection components. Return a
// promise that resolves with an object with key=name, value=react component.
const collectionComponentBuilders = {
  addons: Task.async(function* (provider, serverRecords) {
    Cu.import("resource://services-sync/engines/addons.js");
    if (typeof AddonValidator == "undefined") {
      return {
        "Validation": [React.createElement("p", { key: "update-validation" },
          "You need to update your browser to see validation results")],
      };
    }
    // TODO: think about provider... AddonValidator wants to ask the engine if
    // the addon should be synced -- That probably doesn't really need the engine
    let addonsEngine = Weave.Service.engineManager.get("addons");

    let validator = new AddonValidator(addonsEngine);
    let clientRecords = yield validator.getClientItems();
    let validationResults = validator.compareClientWithServer(clientRecords, serverRecords);

    let serverMap = new Map(validationResults.records.map(item => [item.id, item]));
    let clientMap = new Map(validationResults.clientRecords.map(item => [item.id, item]));
    let fullClientData = expandProtoGetters(clientRecords, ["syncGUID", "id"]);
    fullClientData.forEach(cr => {
      let normed = clientMap.get(cr.syncGUID);
      if (normed) {
        normed.original = cr;
        cr.normalized = normed;
      }
    });

    return {
      "Validation": React.createElement(CollValidationResultDisplay, {
        clientMap,
        serverMap,
        serverRecords,
        problems: validationResults.problemData
      }),
      "Raw validation results": createObjectInspector("Validation", validationResults),
      "Client Records": createTableInspector(fullClientData),
    };
  }),

  passwords: Task.async(function* (provider, serverRecords) {
    Cu.import("resource://services-sync/engines/passwords.js");
    if (typeof PasswordValidator == "undefined") {
      return {
        "Validation": [React.createElement("p", { key: "update-validation" },
          "You need to update your browser to see validation results")],
      };
    }

    let validator = new PasswordValidator();
    let clientRecords = yield validator.getClientItems();
    let validationResults = validator.compareClientWithServer(clientRecords, serverRecords);

    let serverMap = new Map(validationResults.records.map(item => [item.id, item]));
    let clientMap = new Map(validationResults.clientRecords.map(item => [item.id, item]));
    let fullClientData = expandProtoGetters(clientRecords, ["guid", "id"]);
    fullClientData.forEach(cr => {
      let normed = clientMap.get(cr.guid);
      if (normed) {
        normed.original = cr;
        cr.normalized = normed;
      }
    });

    return {
      "Validation": React.createElement(CollValidationResultDisplay, {
        clientMap,
        serverMap,
        serverRecords,
        problems: validationResults.problemData
      }),
      "Raw validation results": createObjectInspector("Validation", validationResults),
      "Client Records": createTableInspector(fullClientData),
    };
  }),

  forms: Task.async(function* (provider, serverRecords) {
    Cu.import("resource://services-sync/engines/forms.js");
    if (typeof FormValidator == "undefined") {
      return {
        "Validation": [React.createElement("p", { key: "update-validation" },
          "You need to update your browser to see validation results")],
      };
    }

    let validator = new FormValidator();
    let clientRecords = yield validator.getClientItems();
    let validationResults = validator.compareClientWithServer(clientRecords, serverRecords);

    let serverMap = new Map(validationResults.records.map(item => [item.id, item]));
    let clientMap = new Map(validationResults.clientRecords.map(item => [item.id, item]));
    return {
      "Validation": React.createElement(CollValidationResultDisplay, {
        clientMap,
        serverMap,
        serverRecords,
        problems: validationResults.problemData
      }),
      "Raw validation results": createObjectInspector("Validation", validationResults),
      "Client Records": createTableInspector(clientRecords),
    };
  }),

  bookmarks: Task.async(function* (provider, serverRecords) {
    try {
      Cu.import("resource://services-sync/bookmark_validator.js");
      // Early versions of this module had no "BookmarkProblemData", so check
      // that here.
      if (!BookmarkProblemData) {
        throw "needs update"; // caught just below!
      }
    } catch (_) {
      return {
        "Validation": [React.createElement("p", { key: "update-validation" },
          "You need to update your browser to see validation results")],
      }
    }

    let clientTree = yield provider.promiseBookmarksTree();
    let validator = new BookmarkValidator();
    let validationResults = yield Promise.resolve(validator.compareServerWithClient(serverRecords, clientTree));
    let probs = validationResults.problemData;

    // If we're running locally, add syncChangeCounter and syncStatus to the
    // client records so that it shows up in various tables.
    if (ProviderState.useLocalProvider) {
      let rows = yield promiseSql("select syncChangeCounter, syncStatus, guid from moz_bookmarks");
      let lookup = new Map(rows.map(row => [row.guid, row]));
      for (let bmark of validationResults.clientRecords) {
        let item = lookup.get(bmark.guid);
        if (!item) {
          continue;
        }
        bmark.syncChangeCounter = item.syncChangeCounter;
        bmark.syncStatus = item.syncStatus;
      }
    }

    // Turn the list of records into a map keyed by ID.
    let serverMap = new Map(serverRecords.map(item => [item.id, item]));
    // Ensure that we show the instance the validator considered canonical
    // (this may be different in the case of duplicate ids).
    validationResults.records.forEach(record => serverMap.set(record.id, record));

    let clientMap = new Map(validationResults.clientRecords.map(item => [item.id, item]))

    function describeId(string, id) {
      return describeIdFull(string, id, clientMap, serverMap);
    }

    let generateResults = function* () {
      if (probs.missingIDs) {
        yield React.createElement("p", null, `There are ${probs.missingIDs} records without IDs`);
      }
      if (probs.rootOnServer) {
        yield React.createElement("p", null, "The root is present on the server, but should not be.");
      }

      for (let { parent, child } of probs.missingChildren) {
        let desc = describeId("Server record references child {id} that doesn't exist on the server.", child);
        yield React.createElement("div", null,
                React.createElement("p", null, ...desc),
                createTableInspector([serverMap.get(parent)])
              );
      }

      for (let { parents, child } of probs.multipleParents) {
        let data = [ serverMap.get(child) ];
        for (let parent of parents) {
          data.push(serverMap.get(parent));
        }
        let desc = describeId("Child record {id} appears as a child in multiple parents", child);
        yield React.createElement("div", null,
                React.createElement("p", null, ...desc),
                createTableInspector(data)
              );
      }

      if (probs.duplicates.length) {
        for (let dupeId of probs.duplicates) {
          let dupes = serverRecords.filter(id => id === dupeId);
          for (let dup of dupes) {
            // Since the validator bails out immediately when it sees a duplicate,
            // these properties won't be filled in for any but the first.
            if (!dup.parent) {
              dup.parent = serverMap.get(dup.parentid);
            }
            if (dup.children && !dup.childGUIDs) {
              dup.childGUIDs = dup.children;
              dup.children = dup.childGUIDs.map(id => serverMap.get(id));
            }
          }
          yield React.createElement("div", null,
            describeId("The id {id} appears multiple times on the server.", dupeId),
            createTableInspector(dupes)
          );
        }
      }

      for (let { parent, child } of probs.parentChildMismatches) {
        let desc = describeId("Server-side parent/child mismatch for parent {id} (first) and ", parent)
          .concat(describeId("child {id} (second).", child))
        yield React.createElement("div", null,
                React.createElement("p", null, ...desc),
                createTableInspector([serverMap.get(parent), serverMap.get(child)])
              );
      }

      for (let cycle of probs.cycles) {
        let desc = React.createElement("p", null,
          `Cycle detected through ${cycle.length} items on server`,
          cycle.map((id, index) =>
            describeId(`${index ? ":" : " =>"} {id}`)));
        yield React.createElement("div", null, desc,
          createTableInspector(cycle.map(id => serverMap.get(id))));
      }

      if (probs.orphans.length) {
        yield React.createElement("div", null,
          React.createElement("p", null, "The following server records are orphans"),
          createTableInspector(probs.orphans.map(({ id, parent }) => ({
            childID: id,
            parentID: parent,
            child: serverMap.get(id),
            parent: serverMap.get(parent),
            // hm...
            clientChild: clientMap.get(id),
            clientParent: clientMap.get(parent),
          })))
        );
      }

      if (probs.clientCycles && probs.clientCycles.length) {
        for (let cycle of probs.clientCycles) {
          let desc = React.createElement("p", null,
            `Cycle detected through ${cycle.length} items on client`,
            cycle.map((id, index) =>
              describeId(`${index ? ":" : " =>"} {id}`)));
          yield React.createElement("div", null, desc,
            createTableInspector(cycle.map(id => serverMap.get(id))));
        }
      }

      yield describeProblemList(
        "The following server records have deleted parents not deleted but had a deleted parent.",
        probs.deletedParents, serverMap);

      yield describeProblemList(
        "The following server records had the same child id multiple their children lists.",
        probs.duplicateChildren, serverMap);

      yield describeProblemList(
        "The following server records had a non-folder for a parent.",
        probs.parentNotFolder, serverMap);

      yield describeProblemList(
        "The following server records were not folders but contained children.",
        probs.childrenOnNonFolder, serverMap);

      yield describeProblemList(
        "The following server records appear on the server but not on the client.",
        probs.clientMissing, serverMap);

      yield describeProblemList(
        "The following server records appear on the server but should not have been uploaded.",
        probs.serverUnexpected, serverMap);

      yield describeProblemList(
        "The following records appear on the client but not on the server.",
        probs.serverMissing, clientMap);

      yield describeProblemList(
        "The following records appear on the client but were marked as deleted on the server.",
        probs.serverDeleted, clientMap);
      const structuralDifferenceFields = ['childGUIDs', 'parentid'];

      let typicalDifferenceData = probs.differences;
      let structuralDifferenceData = probs.structuralDifferences;

      function diffTableEntry(id, field) {
        let result = {
          id,
          field,
          localRecord: clientMap.get(id),
          serverRecord: serverMap.get(id),
        };
        if (result.localRecord) {
          result.localValue = result.localRecord[field];
        }

        if (result.serverRecord) {
          result.serverValue = result.serverRecord[field];
        }
        return result;
      }

      for (let { id, differences } of typicalDifferenceData) {
        let diffTable = differences.map(field => diffTableEntry(id, field))
        let desc = describeId("Record {id} has (non-structural) differences between local and server copies", id);
        yield React.createElement("div", null,
                React.createElement("p", null, ...desc),
                createTableInspector(diffTable)
              );
      }

      for (let { id, differences } of structuralDifferenceData) {
        let diffTable = differences.map(field => diffTableEntry(id, field));
        let desc = describeId(`Record {id} has structural differences (fields: ${JSON.stringify(differences)}) between local and server copies`, id);
        yield React.createElement("div", null,
                React.createElement("p", null, ...desc),
                createTableInspector(diffTable)
              );
      }
    }

    // We can't use the tree we generated above as the bookmark validator
    // mutates it.
    let rawTree = yield provider.promiseBookmarksTree();
    let validationElements = [...generateResults()].filter(Boolean);
    if (validationElements.length == 0) {
      validationElements = [React.createElement("div", null,
                             React.createElement("p", null, "No validation problems found \\o/"))];
    }
    return {
      "Validation": validationElements,
      "Raw validation results": [createObjectInspector("Validation", validationResults)],
      "Client Records": [createTableInspector(validationResults.clientRecords)],
      "Client Tree": [createObjectInspector("root", rawTree)],
      "SQL": [React.createElement(PlacesSqlView)],
    };
  }),

}

// Renders a single collection
class CollectionViewer extends React.Component {
  constructor(props) {
    super(props);
    this.state = {};
  }

  componentDidMount() {
    this.props.provider.promiseCollection(this.props.info).then(result => {
      let { response, records} = result;
      // run the summary builder that's specific to this collection.
      let additionalBuilder = collectionComponentBuilders[this.props.info.name];
      this.setState({ response, records, hasAdditional: !!additionalBuilder, additional: null });
      return additionalBuilder ? additionalBuilder(this.props.provider, records) : null;
    }).then(additional => {
      this.setState({ additional });
    }).catch(err => console.error("Failed to fetch collection", err));
  }

  render() {
    let name = this.props.info.name;
    let details = [React.createElement("div", { className: "collection-header" }, name)];
    if (this.state.records === undefined) {
      details.push(React.createElement(Fetching, { label: "Fetching records..." }));
    } else {
      // Build up a set of tabs.
      let lastModified = new Date(this.props.info.lastModified);
      // "Summary" tab is first.
      let numDeleted = this.state.records.filter(r => r.deleted).length;
      let summary = React.createElement("div", null,
                      React.createElement("p", { className: "collectionSummary" }, `${this.state.records.length} records (${numDeleted} deleted)`),
                      React.createElement("span", { className: "collectionSummary" }, " last modified at "),
                      React.createElement("span", { className: "collectionSummary" }, lastModified.toString())
                    );

      let tabs = [
        React.createElement(ReactSimpleTabs.Panel, { title: "Summary"}, summary),
      ];
      // Do we have additional components for this collection?
      if (this.state.hasAdditional) {
        // We are expecting additional components - do we have them yet?
        if (this.state.additional) {
          for (let title in this.state.additional) {
            let elts = this.state.additional[title];
            if (!elts[Symbol.iterator] && !Array.isArray(elts)) {
              elts = [elts];
            }
            tabs.push(React.createElement(ReactSimpleTabs.Panel, { title }, ...elts));
          }
        } else {
          tabs.push(React.createElement(Fetching, { label: "Building additional info..." }))
        }
      }
      // and tabs common to all collections.
      tabs.push(...[
        React.createElement(ReactSimpleTabs.Panel, { title: "Response" },
                            createObjectInspector("Response", this.state.response)),
        React.createElement(ReactSimpleTabs.Panel, { title: "Records (table)" },
                            createTableInspector(this.state.records)),
        React.createElement(ReactSimpleTabs.Panel, { title: "Records (object)" },
                            createObjectInspector("Records", this.state.records)),
      ]);
      details.push(React.createElement(ReactSimpleTabs, null, ...tabs));
    }

    return React.createElement("div", { className: "collection" },
      ...details
    );
  }
}

// Drills into info/collections, grabs sub-collections, and renders them
class CollectionsViewer extends React.Component {
  componentWillReceiveProps(nextProps) {
    this.setState( {info: null });
    this._updateCollectionInfo(nextProps.provider);
  }

  componentDidMount() {
    this._updateCollectionInfo(this.props.provider);
  }

  _updateCollectionInfo(provider) {
    provider.promiseCollectionInfo().then(info => {
      this.setState({ info, error: null });
    }).catch(err => {
      console.error("Collection viewer failed", err);
      this.setState({ error: err });
    });
  }

  render() {
    if (this.state && this.state.error) {
      return React.createElement("div", null,
               React.createElement("p", null, "Failed to load collection: " + this.state.error)
             );
    }

    if (!this.state || !this.state.info) {
      return React.createElement(Fetching, "Fetching collection info...");
    }

    let provider = this.props.provider;
    let info = this.state.info;
    let collections = [];

    for (let collection of info.collections) {
      collections.push(
        React.createElement(CollectionViewer, { provider, info: collection })
      );
    }
    return React.createElement("div", null,
             React.createElement("p", null, "Status: " + info.status),
             ...collections
           );
  }
}

// Options for what "provider" is used.
class ProviderOptions extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      local: ProviderState.useLocalProvider,
      url: ProviderState.url,
    };
  }

  componentWillUpdate(nextProps, nextState) {
    ProviderState.useLocalProvider = nextState.local;
    ProviderState.url = nextState.url;
  }

  render() {
    let onLocalClick = event => {
      this.setState({ local: true });
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
    }

    let local =
      React.createElement("p", null,
        React.createElement("input", { type: "radio", checked: this.state.local, onChange: onLocalClick }),
        React.createElement("span", null, "Load local Sync data")
      );
    let file =
      React.createElement("p", null,
        React.createElement("input", { type: "radio", checked: !this.state.local, onChange: onExternalClick }),
        React.createElement("span", null, "Load JSON from url"),
        React.createElement("span", { className: "provider-extra", hidden: this.state.local },
          React.createElement("input", { value: this.state.url, onChange: onInputChange }),
          React.createElement("button", {onClick: onChooseClick }, "Choose local file...")
        )
      );
    return React.createElement("div", null, local, file);
  }
}


class ProviderInfo extends React.Component {
  constructor(props) {
    super(props);
    this.state = { provider: ProviderState.newProvider(), anonymize: true };
  }

  componentDidMount() {
    this.componentDidUpdate();
  }

  componentDidUpdate() {
    ReactDOM.render(React.createElement(CollectionsViewer, { provider: this.state.provider }),
                    document.getElementById('collections-info'));
  }

  render() {
    let onLoadClick = () => {
      this.setState({ provider: ProviderState.newProvider() });
    }

    let onExportClick = () => {
      const nsIFilePicker = Ci.nsIFilePicker;
      let titleText = "Select name to export the JSON data to";
      let fp = Cc["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
      let fpCallback = result => {
        if (result == nsIFilePicker.returnOK || result == nsIFilePicker.returnReplace) {
          let filename = fp.file.QueryInterface(Ci.nsILocalFile).path;
          this.state.provider.promiseExport(filename, this.state.anonymize).then(() => {
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
    }

    let providerIsLocal = this.state.provider.type == "local";

    return React.createElement("fieldset", null,
             React.createElement("legend", null, "Data provider options"),
             React.createElement(ProviderOptions, null),
             React.createElement("button", { onClick: onLoadClick }, "Load"),
             React.createElement("button", { onClick: onExportClick, hidden: !providerIsLocal }, "Export to file..."),
             React.createElement("span", { hidden: !providerIsLocal},
              React.createElement("label", null,
                React.createElement("input", { type: "checkbox", defaultChecked: true,
                                               onChange: event => this.setState( { anonymize: event.target.checked }) }),
                "Anonymize data")
             )
           );
  }
}

// I'm sure this is very un-react-y - I'm just not sure how it should be done.
let ProviderState = {
  newProvider() {
    if (this.useLocalProvider) {
      return new Providers.LocalProvider();
    }
    return new Providers.JSONProvider(this.url);
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

let providerElement;

function refreshProvider() {
  // At some point this should be able to have the provider use if-modified-since
  // etc to do the right thing - for now it does a full refresh.
  providerElement.setState({ provider: ProviderState.newProvider() });
}

function render() {
  // I have no idea what I'm doing re element attribute states :)
  for (let elt of document.querySelectorAll(".state-container")) {
    elt.setAttribute("data-logged-in", "unknown");
  }
  whenSyncReady().then(loggedIn => {
    for (let elt of document.querySelectorAll(".state-container")) {
      elt.setAttribute("data-logged-in", loggedIn);
    }

    // Render the nodes that exist in any state.
    ReactDOM.render(React.createElement(LogFilesComponent, null),
                    document.getElementById('logfiles-info')
    );

    ReactDOM.render(
      React.createElement(InternalAnchor,
                          { href: "about:preferences#sync"},
                          "Open Sync Preferences"),
      document.getElementById('opensyncprefs')
    );

    if (!loggedIn) {
      return;
    }
    // render the nodes that require us to be logged in.
    ReactDOM.render(React.createElement(AccountInfo, null),
                    document.getElementById('account-info')
    );

    providerElement = ReactDOM.render(React.createElement(ProviderInfo, null),
                                      document.getElementById('provider-info'));

  }).catch(err => console.error("render() failed", err));
}

// An observer that supports weak-refs (but kept alive by the window)
window.myobserver = {
  QueryInterface: function(iid) {
    if (!iid.equals(Ci.nsIObserver) &&
        !iid.equals(Ci.nsISupportsWeakReference) &&
        !iid.equals(Ci.nsISupports))
      throw Cr.NS_ERROR_NO_INTERFACE;

    return this;
  },
  observe: function(subject, topic, data) {
    render();
  }
};

function main() {
  render();

  const topics = [
    "fxaccounts:onlogin",
    "fxaccounts:onverified",
    "fxaccounts:onlogout",
    "fxaccounts:update",
    "fxaccounts:profilechange"
  ];
  for (let topic of topics) {
    Services.obs.addObserver(window.myobserver, topic, true);
  }
}

main();
