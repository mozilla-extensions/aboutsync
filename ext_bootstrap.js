const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/Preferences.jsm");
const WeaveConstants = Cu.import("resource://services-sync/constants.js", {});
Cu.import("resource://gre/modules/Log.jsm");
Cu.import("resource://services-sync/main.js");

if (typeof console !== "object") {
  XPCOMUtils.defineLazyModuleGetter(this, "console",
                                    "resource://gre/modules/Console.jsm");
}

XPCOMUtils.defineLazyServiceGetter(this, "AlertsService", "@mozilla.org/alerts-service;1", "nsIAlertsService");

// data: URIs we use with the nsIProcessScriptLoader to register "about:sync"
// in all processes.
const DATA_URI_REGISTER_ABOUT = "data:,new " + function() {
  Components.utils.import("chrome://aboutsync/content/AboutSyncRedirector.js");
  AboutSyncRedirector.register();
};

const DATA_URI_UNREGISTER_ABOUT = "data:,new " + function() {
  Components.utils.import("chrome://aboutsync/content/AboutSyncRedirector.js");
  AboutSyncRedirector.unregister();
};

const PREF_VERBOSE = "extensions.aboutsync.verbose";
let verbose = false;

function log(...args) {
  console.log(" *** aboutsync: ", ...args);
}

function debug(...args) {
  if (verbose) {
    console.log(" ***** aboutsync: ", ...args);
  }
}

const ENGINE_NAMES = ["addons", "bookmarks", "clients", "forms", "history",
                      "passwords", "prefs", "tabs"];

function prefObserver(subject, topic, data) {
  debug("saw preference", data, "change");
  if (data == PREF_VERBOSE) {
    try {
      verbose = Services.prefs.getBoolPref(PREF_VERBOSE);
    } catch (ex) {}
  }
}

const PREF_RESTORE_TOPICS = [
  "weave:service:start-over",
  "weave:service:start-over:finish",
];


// We'll show some UI on certain sync status notifications - currently just
// errors.
const SYNC_STATUS_TOPICS = [
  "weave:service:sync:error",
  "weave:service:sync:finish",
  "weave:service:login:error",
];

function syncStatusObserver(subject, topic, data) {
  if (!shouldReportError(data)) {
    return;
  }
  let clickCallback = (subject, topic, data) => {
    if (topic != "alertclickcallback")
      return;
    let win = Services.wm.getMostRecentWindow("navigator:browser");
    if (win) {
      win.switchToTabHavingURI("about:sync-log", true);
    } else {
      log("Failed to find a window to open the log url");
    }
  }
  let hide = Services.prefs.getBoolPref("extensions.aboutsync.hideNotifications", false);
  if (!hide) {
    let body = "about-sync noticed a sync failure - click here to view sync logs";
    AlertsService.showAlertNotification(null, "Sync Failed", body, true, null, clickCallback);
  }
}

function shouldReportError(data) {
  if (Weave.Status.service == WeaveConstants.STATUS_OK ||
      Weave.Status.login == WeaveConstants.MASTER_PASSWORD_LOCKED) {
    return false;
  }

  if (Weave.Status.login == WeaveConstants.LOGIN_FAILED_LOGIN_REJECTED) {
    return true;
  }

  let lastSync = Weave.Svc.Prefs.get("lastSync");
  if (lastSync && ((Date.now() - Date.parse(lastSync)) >
      Weave.Svc.Prefs.get("errorhandler.networkFailureReportTimeout") * 1000)) {
    return true;
  }

  // We got a 401 mid-sync. Wait for the next sync before actually handling
  // an error. This assumes that we'll get a 401 again on a login fetch in
  // order to report the error.
  if (!Weave.Service.clusterURL) {
    return false;
  }

  return ![Weave.Status.login, Weave.Status.sync].includes(WeaveConstants.SERVER_MAINTENANCE) &&
         ![Weave.Status.login, Weave.Status.sync].includes(WeaveConstants.LOGIN_FAILED_NETWORK_ERROR);
}

// Register a chrome URL. This sucks in so many ways
// 1) That we need a chrome URL at all. We can get quite a way with just a
//    resource URL, until it comes time to load index.html, at which time we
//    don't have chrome permissions (which is a shame, as we can Cu.import
//    our modules from the same resource:// base URL and they do have chrome
//    permissions)
// 2) We have to call addBootstrappedManifestLocation, which is probably
//    going to go away once bootstrapped extensions do. If we weren't in a .xpi
//    file we could call nsIComponentRegistrar.autoRegister with an nsIFile
//    pointing at our chrome.manifest.
function registerChrome(data) {
  let mgr = Components.manager.QueryInterface(Ci.nsIComponentManager);
  let url = data.context.extension.resourceURL;
  let match = url.match(/^jar:(.+?)!\/$/);
  if (match) {
    url = match[1];
  }

  let uri = Services.io.newURI(url);
  uri.QueryInterface(Ci.nsIFileURL);
  mgr.addBootstrappedManifestLocation(uri.file);
}

let isAppShuttingDown = false;
function onQuitApplicationGranted() {
  isAppShuttingDown = true;
}

/*
 * Extension entry points
 */
function startup(data, reason) {
  log("starting up");

  registerChrome(data);

  // Watch for prefs we care about.
  Services.prefs.addObserver(PREF_VERBOSE, prefObserver, false);
  // Ensure initial values are picked up.
  prefObserver(null, "", PREF_VERBOSE);
  for (let engine of ENGINE_NAMES) {
    let pref = "services.sync.log.logger.engine." + engine;
    Services.prefs.addObserver(pref, prefObserver, false);
  }
  // Register about:sync in all processes (note we only load in the parent
  // processes, but child processes need to know the page exists so it can
  // ask the parent to load it)
  Services.ppmm.loadProcessScript(DATA_URI_REGISTER_ABOUT, true);

  // We'll display a notification on sync failure.
  for (let topic of SYNC_STATUS_TOPICS) {
    Services.obs.addObserver(syncStatusObserver, topic, false);
  }

  Services.obs.addObserver(onQuitApplicationGranted, "quit-application-granted", false);

  // for some reason we can't use chrome://aboutsync at the top-level of
  // this module, but only after startup is called.
  const { Config } = Cu.import("chrome://aboutsync/content/config.js", {});
  Config.initialize();
}

function shutdown(data, reason) {
  // When the application is shutting down we don't have to clean anything up.
  // (Note that there's no actual guarantee isAppShuttingDown will be set
  // by the time we are called here, but it usually is, and this is just an
  // optimization, so it doesn't really matter if it isn't)
  if (isAppShuttingDown) {
    return;
  }

  log("extension is shutting down");

  // Stop registering about:sync in new processes.
  Services.ppmm.removeDelayedProcessScript(DATA_URI_REGISTER_ABOUT);
  // And unregister about:sync in any processes we've already loaded in.
  Services.ppmm.loadProcessScript(DATA_URI_UNREGISTER_ABOUT, false);

  let wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);

  Services.prefs.removeObserver(PREF_VERBOSE, prefObserver);

  Services.obs.removeObserver(onQuitApplicationGranted, "quit-application-granted");

  for (let topic of SYNC_STATUS_TOPICS) {
    Services.obs.removeObserver(syncStatusObserver, topic);
  }

  const { Config } = Cu.import("chrome://aboutsync/content/config.js", {});
  Config.finalize();
  // And unload it, so changes will get picked up if we reload the addon.
  Cu.unload("chrome://aboutsync/content/config.js");
}

function install(data, reason) {}
function uninstall(data, reason) {}

// shims for webextension hacks.
var EXPORTED_SYMBOLS = ["AboutSyncBootstrap"];

this.AboutSyncBootstrap = {
  startup,
  shutdown,
  install,
  uninstall,
};
