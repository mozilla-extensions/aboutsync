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

// Utilities to initialize the addon...
function loadIntoWindow(window) {
  if (!window)
    return;
  let wintype = window.document.documentElement.getAttribute('windowtype');
  if (wintype != "navigator:browser") {
    log("not installing aboutsync extension into window of type " + wintype);
    return;
  }
  // Add persistent UI elements to the "Tools" ment.
  let menuItem = window.document.createElement("menuitem");
  menuItem.setAttribute("id", "aboutsync-menuitem");
  menuItem.setAttribute("label", "About Sync");
  menuItem.addEventListener("command", function(event) {
    let win = event.target.ownerDocument.defaultView;
    let tab = win.gBrowser.addTab("about:sync");
    win.gBrowser.selectedTab = tab;
  }, true);
  let menu = window.document.getElementById("menu_ToolsPopup");
  if (!menu) {
    // might be a popup or similar.
    log("not installing aboutsync extension into browser window as there is no Tools menu");
  }
  menu.appendChild(menuItem);
  debug("installing aboutsync into new window");
}

function unloadFromWindow(window) {
  if (!window)
    return;
  window.document.getElementById("aboutsync-menuitem").remove();
  // Remove any persistent UI elements
  // Perform any other cleanup
}

let windowListener = {
  onOpenWindow: function(aWindow) {
    // Wait for the window to finish loading
    let domWindow = aWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
    domWindow.addEventListener("load", function onLoad() {
      domWindow.removeEventListener("load", onLoad, false);
      loadIntoWindow(domWindow);
    }, false);
  },

  onCloseWindow: function(aWindow) {},
  onWindowTitleChange: function(aWindow, aTitle) {}
};

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
SYNC_STATUS_TOPICS = [
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

/*
 * Extension entry points
 */
function startup(data, reason) {
  log("starting up");
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

  // Load into any existing windows
  let windows = Services.wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    loadIntoWindow(domWindow);
  }

  // Load into any new windows
  Services.wm.addListener(windowListener);

  // for some reason we can't use chrome://aboutsync at the top-level of
  // this module, but only after startup is called.
  const { Config } = Cu.import("chrome://aboutsync/content/config.js", {});
  Config.initialize();
}

function shutdown(data, reason) {
  // When the application is shutting down we normally don't have to clean
  // up any UI changes made
  if (reason == APP_SHUTDOWN)
    return;

  // Stop registering about:sync in new processes.
  Services.ppmm.removeDelayedProcessScript(DATA_URI_REGISTER_ABOUT);
  // And unregister about:sync in any processes we've already loaded in.
  Services.ppmm.loadProcessScript(DATA_URI_UNREGISTER_ABOUT, false);

  let wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);

  // Stop listening for new windows
  wm.removeListener(windowListener);

  // Unload from any existing windows
  let windows = wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    try {
      unloadFromWindow(domWindow);
    } catch (ex) {
      log("Failed to reset window: " + ex + "\n" + ex.stack);
    }
  }
  Services.prefs.removeObserver(PREF_VERBOSE, prefObserver);

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
