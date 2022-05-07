// A simple panel, inspired by https://codepen.io/adamaoc/pen/wBGGQv

const React = require("react");

class Panel extends React.Component {
  constructor(props) {
    super(props);
    // Set open to the opposite of the real value - we'll toggle it when
    // the component mounts.
    this.state = {
      open: !props.open,
    };
  }

  componentDidMount() {
    this.handleClick();
  }

  handleClick(evt) {
    if (this.state.open) {
      this.setState({
        open: false,
        class: "panel"
      });
    } else {
      this.setState({
        open: true,
        class: "panel open"
      });
    }
  }

  render() {
    return (
      <div className={this.state.class}>
        <button>toggle</button>
        <div className="panelhead" onClick={evt => this.handleClick(evt)}>{this.props.title}</div>
        <div className="panelwrap">
          <div className="panelContent">
            {this.props.children}
          </div>
        </div>
      </div>
    );
  }
}

// I'd really like to add "accordion" support here (so only one panel can
// be open at a time), but working out how to manage that is tricky.
// And maybe it's actually not such a great idea anyway?
class PanelGroup extends React.Component {
  render() {
    return (
      <div className="panelgroup">
        <div className="title">{this.props.title}</div>
        {this.props.children}
      </div>
    );
  }
}

module.exports = { Panel, PanelGroup };
