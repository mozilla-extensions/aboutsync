const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
const React = require("react");

const { ErrorDisplay, valueLookupTable, importLocal } = require("./common");
const { TableInspector } = require("./AboutSyncTableInspector");

const { Services } = importLocal("resource://gre/modules/Services.jsm");
const { PlacesUtils } = importLocal("resource://gre/modules/PlacesUtils.jsm");

const sqlQueryPref = "extensions.aboutsync.lastQuery";

function getLastQuery() {
  return Services.prefs.getStringPref(sqlQueryPref,
                                      "select * from moz_bookmarks\nlimit 100");
}

function updateLastQuery(query) {
  Services.prefs.setStringPref(sqlQueryPref, query);
}

function getSqlColumnNames(sql) {
  // No way to get column names from the async api :(... Bug 1326565.
  let stmt;
  try {
    const db = PlacesUtils.history.DBConnection;
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
  return PlacesUtils.withConnectionWrapper(
    "AboutSync: promiseSql", async function(db) {
    let columnNames = getSqlColumnNames(sql);
    let rows = await db.executeCached(sql, params);
    let resultRows = rows.map(row => {
      let resultRow = {};
      for (let columnName of columnNames) {
        resultRow[columnName] = row.getResultByName(columnName);
      }
      return resultRow;
    });
    return resultRows; // Return column names too?
  });
}

class PlacesSqlView extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      text: getLastQuery(),
      rows: [],
      error: null
    };
  }

  executeSql() {
    promiseSql(this.state.text).then(rows => {
      let summary = `${rows.length} row(s) returned.`;
      this.setState(Object.assign(this.state, { rows, error: undefined, summary }));
      updateLastQuery(this.state.text);
    }).catch(error => {
      this.setState(Object.assign(this.state, { error, summary: undefined }));
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
    return (
      <div className="sql-view">
        <div className="sql-editor">
          <textarea value={this.state.text}
                    onChange={e => this.setState({ text: e.target.value })}/>
          <button className="execute-sql" onClick={e => this.executeSql()}>
            Execute SQL
          </button>
        </div>

        <ErrorDisplay error={this.state.error}
                      onClose={() => this.setState({error: null})}
                      prefix="Error running SQL: "
                      formatError={e => this.renderErrorMsg(e)}/>

        {this.state.summary && (
          <p className="sql-summary">{this.state.summary}</p>
        )}
        <TableInspector data={this.state.rows}/>
      </div>
    );
  }
}

module.exports = {
  PlacesSqlView,
  promiseSql,
};
