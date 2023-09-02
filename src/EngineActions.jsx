"use strict";
const React = require("react");
const { toast, toast_error } = require('./common');
const PropTypes = require("prop-types");

class EngineActions extends React.Component {

  static get propTypes() {
    return {
      engine: PropTypes.object.isRequired,
    };
  }

  constructor(props) {
    super(props);
    this.state = {};
  }

  reset(event) {
    let e = this.props.engine;
    e._log.info("about:sync resetting engine due to user request");
    e.resetClient().then(() => {
      toast("Reset complete");
    }).catch(err => {
      toast_error("Failed to reset the engine", err);
    });
  }

  wipe(event) {
    let e = this.props.engine;
    e._log.info("about:sync wiping engine due to user request");
    e.wipeServer().then(() => {
      toast("Wipe complete");
    }).catch(err => {
      toast_error("Failed to wipe the engine", err);
    });
  }

  render() {
    let reset;
    if (this.props.engine.resetClient) {
      reset = 
        <div>
          <span>Resetting an engine clears all local state, so the next Sync will
                act as though this was the first sync for that engine's data -
                all records will be downloaded, compared against local records
                and missing records uploaded - 
          </span>
          <button onClick={event => this.reset(event)}>Reset {this.props.engine.name}</button>
        </div>
    }
    let canWipe = !["crypto", "meta"].includes(this.props.engine.name);
    let wipe;
    if (canWipe) {
      wipe =
        <div>
          <span>Wiping an engine removes data from the server. <em>It does not remove local data</em>.
                This device will upload all its data. Other devices will act like a <i>Reset</i>, as described above.
                -
          </span>
          <button onClick={event => this.wipe(event)}>Wipe {this.props.engine.name}</button>
        </div>
    };
    return (
      <>
      { reset }
      { wipe }
    </>
  );
  }
}

module.exports = { EngineActions };
