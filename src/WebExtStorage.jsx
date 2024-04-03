import React from 'react'

const { ObjectInspector } = require("./common");
const { extensionStorageSync } = ChromeUtils.importESModule( "resource://gre/modules/ExtensionStorageSync.sys.mjs");

export class WebExtStorage extends React.Component {
  constructor(props) {
    super(props);
    // We use 'about-sync' as an ID for this addon/scratch data. It will sync/merge etc.
    // Could use the addon-manager to turn ids into names?
    let ext_ids = new Set(["about-sync"].concat(props.serverRecords.filter(s => !s.deleted).map(s => s.extId)));
    this.state = {id: "about-sync", ext_ids, data: null, keys: "", error_get: "", set_error: ""};
  }

  async update(state = {}) {
    // simple "truthy" doesn't keep an empty string.
    let keys_text = state.keys === undefined ? this.state.keys : state.keys;
    let id = state.id || this.state.id;
    let error_get = "";
    console.log("webext: update", state);
    let keys = null;
    if (keys_text) {
      try {
        keys = JSON.parse(keys_text);
      } catch (e) {
        error_get = "Invalid keys: not JSON";
      }
    }
    let data = null, bytesInUse = null;
    if (!error_get) {
      try {
        bytesInUse = await extensionStorageSync.getBytesInUse({id}, keys);
        data = await extensionStorageSync.get({id}, keys);
      } catch (e) {
        error_get = `Failed: ${e}`;
      }
    }
    this.setState({data, bytesInUse, error_get, ...state});
  }

  async doSet() {
    let value;
    if (!this.state.toSet) {
      this.setState({ error_change: "No value to set" });
      return;
    }
    try {
      value = JSON.parse(this.state.toSet)
    } catch (e) {
      this.setState({ error_change: "Invalid value" });
      return;
    }
    let ext = { id: this.state.id }
    console.log("webext: setting", ext, value);
    try {
      await extensionStorageSync.set(ext, value);
    } catch (e) {
      console.error("webext: Failed to set extension storage", e);
      this.setState({error_change: `Failed to set: ${e}`});
      return;
    }
    await this.update();
    this.setState({error_change: ""});
  }

  async doClear() {
    let ext = { id: this.state.id }
    console.log("webext: clearing", ext);
    await extensionStorageSync.clear(ext);
    await this.update();
    this.setState({error_change: ""});
  }

  async componentDidMount() {
    await this.update();
  }

  render() {
    // The addon <select> element children.
    let extensions = []; // WTF can't I work out how to use .map on a set!?
    for (let id of this.state.ext_ids) {
      extensions.push(<option value={id}>{id}</option>);
    }
    let get =
      <fieldset>
        <legend>Current Data</legend>
        <div className="horiz-action-row">
          <p>Keys to query</p>
          <textarea className="storage-input"
            value={this.state.keys}
            onChange={e => this.update({keys: e.target.value})}
            placeholder="String, array of strings, or leave empty for null"
          />
        </div>
        <div>
          {this.state.error_get ?
            <p>{ this.state.error_get }</p>
            :
            <>
            <p>Current data ({this.state.bytesInUse} bytes)</p>
            <ObjectInspector data={this.state.data} expandLevel={1}/>
            </>
          }
        </div>
      </fieldset>;

    let change =
      <fieldset>
        <legend>Change Data</legend>
        {this.state.id != "about-sync" &&
          <p className="storage-sync-ext-warning">You are messing with a real extension - you might break it!</p>
        }
        <div className="horiz-action-row">
          <span>Clear all data</span>
          <button onClick={e => this.doClear()}>Clear</button>
        </div>
        <div className="horiz-action-row">
          <span>Set data</span>
          <textarea
            className="storage-input"
            value={this.state.set_value}
            onChange={e => this.setState({toSet: e.target.value})}
            onAc
            placeholder="A JSON object, eg, {'foo': 'bar'}"
          />
          <div>
            <button onClick={e => this.doSet()}>Set</button>
          </div>
        </div>
        <div>
          {this.state.error_change && <p className='error-message'>{this.state.error_change}</p>}
        </div>
      </fieldset>;

    return (
      <>
      <select
        children={extensions}
        value={this.state.id}
        onChange={e => this.update({id: e.target.value })}
      />
      <div className="storage-sync-sections">
        {get}
        {change}
      </div>
      </>
    );
  }
}
