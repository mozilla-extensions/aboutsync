"use strict";
const React = require("react");
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
      alert("Reset complete");
    }).catch(err => {
      console.error("Failed to reset the engine", err);
    });
  }

  render() {
    return (
      <div>
        <span>Resetting an engine clears all local state, so the next Sync will
              act as though this was the first sync for that engine's data - 
              all records will be downloaded, compared against local records
              and missing records uploaded - 
        </span>
        <button onClick={event => this.reset(event)}>Reset {this.props.engine.name}</button>
      </div>
    );
  }
}

module.exports = { EngineActions };
