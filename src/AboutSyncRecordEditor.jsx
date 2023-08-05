"use strict";
const React = require("react");
const PropTypes = require("prop-types");
const { ErrorDisplay } = require("./common");
const { Utils } = ChromeUtils.importESModule("resource://services-sync/util.sys.mjs");

function shortenText(x, maxLen) {
  return x.length >= maxLen ? x.slice(0, maxLen - 1) + "…" : x;
}

function describeRecord(coll, record) {
  if (record.deleted) {
    return "tombstone";
  }
  switch (coll) {
    case "bookmarks":
      return record.title ? `${record.type}: ${record.title}` : record.type;
    case "addons":
      return record.addonID;
    case "clients":
      return record.name;
    case "tabs":
      return record.clientName;
  }
  return null;
}

// Used for the "New Record" menu option. Should never collide with a real record.
const PhonyNewRecordID = "new record";
class AboutSyncRecordEditor extends React.Component {

  static get propTypes() {
    return {
      engine: PropTypes.object.isRequired,
      records: PropTypes.array.isRequired,
    };
  }

  constructor(props) {
    super(props);
    this.state = { selected: PhonyNewRecordID, text: "" };
  }

  componentDidMount() {
    this.selectRecord(PhonyNewRecordID);
  }

  selectRecord(recordId) {
    if (this.state.text && recordId == this.state.selected) {
      return;
    }
    if (recordId == PhonyNewRecordID) {
      let fakeRecord = { id: Utils.makeGUID() };
      this.setState({
        selected: recordId,
        text: JSON.stringify(fakeRecord, null, 2),
      });
      return;
    }
    let record = this.props.records.find(r => r.id == recordId);
    let recordJSON = JSON.stringify(record, null, 2);
    this.setState({
      selected: recordId,
      text: recordJSON,
    });
  }

  async withRequesting(inner) {
    if (this.state.requesting) {
      return;
    }
    this.setState({
      requesting: true
    });
    try {
      await inner();
    } catch (e) {
      console.error("Uncaught error: ", e);
      this.setState({ error: "Unexpected error: " + e })
    } finally {
      this.setState({ requesting: false });
    }
  }

  async update() {
    await this.withRequesting(() => this._update());
  }

  async delete() {
    await this.withRequesting(() => this._delete());
  }

  async _doRequest(request) {
    let resp;
    try {
      resp = await request();
    } catch (e) {
      console.error("Error: ", e);
      this.setState({ error: "Network error: " + e });
      return false;
    }
    if (!resp.success) {
      console.warn("Response:", resp);
      this.setState({ error: `HTTP error code ${resp.status}`})
      return false;
    }
    return true;
  }

  _parseCurrentRecord() {
    let record;
    try {
      record = JSON.parse(this.state.text);
    } catch (e) {
      console.error("Error parsing", e);
      this.setState({ error: e.message });
      return {record: null, id: null};
    }
    if (!record.id) {
      console.error("Bad record?", record);
      this.setState({ error: "No `id` property found" });
      return { record, id: null }
    }
    return { record, id: record.id };
  }

  async _delete() {
    let toDelete = this.state.selected;
    if (toDelete == PhonyNewRecordID) {
      // Delete whatever they have in the list.
      let { id } = this._parseCurrentRecord();
      if (!id) {
        return;
      }
      toDelete = id;
    }
    let resource = this.props.engine.itemSource();
    resource.ids = [toDelete];
    if (!await this._doRequest(() => resource.delete())) {
      // Already updated error state.
      return;
    }
    console.log("Deleted id", toDelete);

    let index = this.props.records.findIndex(r => r.id == toDelete);
    if (index >= 0) {
      // Hackily remove the record from the list without resyncing.
      this.props.records.splice(index, 1);
    }
    this.selectRecord(PhonyNewRecordID);
  }

  async _update() {
    let engine = this.props.engine;
    let { record: parsed, id } = this._parseCurrentRecord();
    if (!parsed || !id) {
      console.log("Bad current record", parsed, this.state.text);
      return;
    }
    let resource = engine.itemSource();
    // We use PUT instead of the post queue to avoid XIUS checks when editing
    // the same record multiple times, but we need a slightly different URI.
    resource.uri = engine.engineURL + "/" + id;

    let record = new engine._recordObj(engine.name, id);
    record.cleartext = parsed;

    let keys = engine.service.collectionKeys.keyForCollection(engine.name)
    await record.encrypt(keys);

    let bytes = JSON.stringify(record.toJSON());

    if (!await this._doRequest(() => resource.put(bytes))) {
      console.log("Something bad happened to the request?");
      // Already updated error state.
      return;
    }

    // Update current record or add a new one.
    let recordIndex = this.props.records.findIndex(r => r.id == id);
    if (recordIndex < 0) {
      this.props.records.push(parsed);
      this.selectRecord(id);
    } else {
      this.props.records[recordIndex] = parsed;
    }
  }

  recordDesc(record) {
    let desc = describeRecord(this.props.engine.name, record);
    if (!desc) {
      return record.id;
    }
    return `${record.id} (${shortenText(desc, 20)})`;
  }

  render() {
    return (
      <div className="record-view">
        <div className="record-picker">
          <label className="record-select-label">
            Select record:
            <select className="record-select"
                    value={this.state.selected}
                    onChange={event => this.selectRecord(event.target.value)}>
              <option value={PhonyNewRecordID} key={PhonyNewRecordID}>
                Create new record
              </option>
              {this.props.records.map(record =>
                <option value={record.id} key={record.id}>
                  {this.recordDesc(record)}
                </option>)}
            </select>
          </label>
        </div>

        <div className="record-editor">
          <textarea value={this.state.text}
                    rows={Math.max(10, this.state.text.split("\n").length + 1)}
                    onChange={e => this.setState({ text: e.target.value })}/>
          <div className="actions">
            <button className="submit update"
                    onClick={e => this.update()}
                    disabled={this.state.requesting}>
              {this.state.requesting ? "Thinking..." : "Dangerously update server record"}
            </button>
            <button className="submit delete"
                    onClick={e => this.delete()}
                    disabled={this.state.requesting}>
              {this.state.requesting ? "Thinking..." : "Dangerously HTTP DELETE"}
            </button>
          </div>
        </div>
        <ErrorDisplay error={this.state.error}
                      onClose={() => this.setState({error: null})}
                      prefix="Error: "/>
        {this.state.error && (
          <div className="error-message">
            <button className="close-error"
                    title="Close"
                    onClick={e => this.setState({error: null})}>X</button>
            <p>Error: {this.state.error}</p>
          </div>
        )}
      </div>
    );
  }
}

module.exports = { AboutSyncRecordEditor };
