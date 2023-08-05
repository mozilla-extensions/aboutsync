const { Log } = ChromeUtils.importESModule("resource://gre/modules/Log.sys.mjs");
const { Weave } = ChromeUtils.importESModule("resource://services-sync/main.sys.mjs");
const WeaveConstants = ChromeUtils.importESModule("resource://services-sync/constants.sys.mjs");
const { XPCOMUtils } = ChromeUtils.importESModule("resource://gre/modules/XPCOMUtils.sys.mjs");
if (typeof console !== "object") {
  var { console  } = ChromeUtils.importESModule("resource://gre/modules/Console.sys.mjs");
}

XPCOMUtils.defineLazyServiceGetter(this, "AlertsService", "@mozilla.org/alerts-service;1", "nsIAlertsService");

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

  let lastSync = Services.prefs.getIntPref("services.sync.lastSync");
  if (lastSync && ((Date.now() - Date.parse(lastSync)) >
      Services.prefs.getIntPref("services.sync.errorhandler.networkFailureReportTimeout") * 1000)) {
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

let chromeHandle;
// Register a chrome URL, which is the only way we've found to have scripts
// loaded by our index.html to have chrome permissions.
function registerChrome(data) {
  let aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"]
                               .getService(Ci.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI("manifest.json", null, data.context.extension.rootURI);
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "aboutsync", "data/"],
  ]);
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
  Services.ppmm.loadProcessScript("chrome://aboutsync/content/RegisterRedirector.js", true);

  // We'll display a notification on sync failure.
  for (let topic of SYNC_STATUS_TOPICS) {
    Services.obs.addObserver(syncStatusObserver, topic, false);
  }

  Services.obs.addObserver(onQuitApplicationGranted, "quit-application-granted", false);

  // for some reason we can't use chrome://aboutsync at the top-level of
  // this module, but only after startup is called.
  const { Config } = ChromeUtils.importESModule("chrome://aboutsync/content/config.js");
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
  Services.ppmm.removeDelayedProcessScript("chrome://aboutsync/content/RegisterRedirector.js");
  // And unregister about:sync in any processes we've already loaded in.
  Services.ppmm.loadProcessScript("chrome://aboutsync/content/UnregisterRedirector.js", true);

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

  chromeHandle.destruct();
  chromeHandle = null;
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
