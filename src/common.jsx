const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
// Utility components/functions that are used in multiple places, but are too
// small to be worth putting in their own module.

const React = require("react");
const ReactInspector = require("react-inspector");
const PropTypes = require("prop-types");

// A placeholder for when we are still fetching data.
function Fetching({label}) {
  return <p className="fetching">{label}</p>;
}

// A tab-smart "anchor"
class InternalAnchor extends React.Component {
  onClick(event) {
    const Ci = Components.interfaces;
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
    return (
      <a href={this.props.href}
         onClick={event => this.onClick(event)}>
        {this.props.children}
      </a>
    );
  }
}

// a custom node renderer for ReactInspector we use by default.
function aboutSyncNodeRenderer({ depth, name, data, isNonenumerable, expanded }) {
  if (depth === 0) {
    // Don't render the object summary if we're expanded, unless there's no given name.
    if (expanded && name) {
      return <ReactInspector.ObjectName name={name} />;
    } else {
      return <ReactInspector.ObjectRootLabel name={name} data={data} />;
    }
  } else {
    return <ReactInspector.ObjectLabel name={name} data={data} isNonenumerable={isNonenumerable} />
  }
};

// Wrapper around ReactInspector.ObjectInspector that sets some common props
function ObjectInspector(props) {
  // We let React do the defaulting for us using defaultProps.
  const darkThemeMq = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = darkThemeMq.matches ? "chromeDark" : "chromeLight";
  return <ReactInspector.ObjectInspector theme={theme} {...props}/>;
}

ObjectInspector.defaultProps = {
    // This lib isn't styled with CSS, so we have to go through this (the default
  // background is white, which looks bad).
  theme: Object.assign({}, ReactInspector.chromeLight, {
    BASE_BACKGROUND_COLOR: "any"
  }),
  nodeRenderer: aboutSyncNodeRenderer
};


function valueLookupTable(o) {
  return new Map(Object.entries(o).map(([k, v]) => [v, k]));
}

// Map of error number to the key in Cr (e.g. 2147500036 => "NS_ERROR_ABORT")
const CrLookupTable = valueLookupTable(Components.results);
class ErrorDisplay extends React.Component {
  static get propTypes() {
    return {
      onClose: PropTypes.func,
      prefix: PropTypes.string,
      formatError: PropTypes.func,
      error: PropTypes.any,
    };
  }

  static get defaultProps() {
    return {
      prefix: "Error: ",
      formatError: ErrorDisplay.defaultFormatter,
    };
  }

  render() {
    if (!this.props.error) {
      return null;
    }
    return (
      <div className="error-message">
        {this.props.onClose && (
          <button className="close-error" onClick={e => this.props.onClose()} title="Close">
            &times;
          </button>
        )}
        <p>
          {this.props.prefix}
          {this.props.formatError(this.props.error)}
        </p>
      </div>
    );
  }

  static defaultFormatter(err) {
    if (err && CrLookupTable.has(err)) {
      return `Cr.${CrLookupTable.get(err)} (${err})`;
    }
    let result = String(err);
    if (result.startsWith("[object")) {
      return <ObjectInspector name="Error" data={result}/>
    }
    return result;
  }
}

// Like Async.jankYielder, but without adding another Cu.import, and uses the
// time since the last yield vs an iteration count (note that unlike sync,
// about:sync isn't running in the background, and the user is waiting on this
// to complete for us to be useful).
function jankYielder(maxTimeSliceMS = 10) {
  let lastYield = performance.now();
  return async () => {
    if (performance.now() - lastYield >= maxTimeSliceMS) {
      await new Promise(requestAnimationFrame);
      lastYield = performance.now();
    }
  };
}

// Replacement for the Cu.cloneInto we do to the records array. For history
// this was causing noticable jank for me, which felt random since history
// sync finishes late anyway.
async function arrayCloneWithoutJank(arr) {
  let result = [];
  const yielder = await jankYielder();
  // Chunking made cloning (100k records of) history take waaaay less time.
  const chunkSize = 100;
  for (let i = 0; i < arr.length; i += chunkSize) {
    let chunkEnd = Math.min(arr.length, i + chunkSize);
    for (let j = i; j < chunkEnd; ++j) {
      result.push(Cu.cloneInto(arr[j], {}));
    }
    await yielder();
  }
  return result;
}

// Cu.import is completely global for us (one file imports, all files see it)
function importLocal(path) {
  const object = {};
  try {
    Components.utils.import(path, object);
  } catch (e) {
    console.error("Failed to import " + path, e);
    return null;
  }
  return object;
}

module.exports = {
  Fetching,
  InternalAnchor,
  ObjectInspector,
  ErrorDisplay,
  jankYielder,
  importLocal,
  arrayCloneWithoutJank,
  valueLookupTable,
};
