const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

const React = require("react");
const ReactDOM = require("react-dom");

const { ConfigComponent } = require("./config");
const { ProviderState, ProviderInfo } = require("./provider");
const { CollectionsViewer } = require("./CollectionsViewer");
const { ErrorDisplay, Fetching, importLocal } = require("./common");
const { AccountInfo } = require("./AccountInfo");

const { Services } = importLocal("resource://gre/modules/Services.jsm");
const { fxAccounts } = importLocal("resource://gre/modules/FxAccounts.jsm");
const { Weave } = importLocal("resource://services-sync/main.js");

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

class AboutSyncHeader extends React.Component {
  renderAccountInfo() {
    if (!this.props.ready) {
      return null;
    }
    if (!this.props.loggedIn) {
      return (
        <div>
          You must <a href="about:preferences#sync">log in</a> to view about-sync
        </div>
      );
    }
    return (
      <div>
        <p className="section-heading">Firefox Account</p>
        <div id="account-info">
          <AccountInfo fxAccounts={fxAccounts}/>
        </div>
      </div>
    );
  }
  render() {
    return (
      <div className="header">
        <div>
          {this.renderAccountInfo()}
        </div>
        <div>
          <p className="section-heading">Options</p>
          <div>
            {this.props.ready && <ConfigComponent/>}
          </div>
        </div>
      </div>
    );
  }
}

class AboutSyncComponent extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      provider: null,
      loggedIn: false,
      ready: false,
    }
  }

  componentDidMount() {
    whenSyncReady().then(loggedIn => {
      this.setState({
        ready: true,
        loggedIn,
        provider: ProviderState.newProvider(),
      });
    }).catch(e => {
      this.setState({error: e})
    })
  }

  refreshProvider() {
    this.setState({
      provider: ProviderState.newProvider()
    });
  }

  render() {
    let loginState = this.state.ready ? String(this.state.loggedIn) : "unknown";
    return (
      <div>
        <div hidden={this.state.ready}>
          <Fetching label="Fetching account..."/>
        </div>

        <AboutSyncHeader loggedIn={this.state.loggedIn}
                         ready={this.state.ready}/>

        {this.state.loggedIn && (
          <div className="body">
            <div className="collections">
              <h2>Collections</h2>
              <button onClick={e => this.refreshProvider()}>Refresh</button>
              <CollectionsViewer provider={this.state.provider}/>
            </div>

            <ProviderInfo provider={this.state.provider}
                          updateProvider={() => this.refreshProvider()}/>
          </div>
        )}
      </div>
    );
  }
}

function render() {
  ReactDOM.render(<AboutSyncComponent/>, document.getElementById("main"));
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
