"use strict";

// Helpers for the config component.

// This is a bit of a special module in that it's imported both by bootstrap.js
// and by the react-based UI code, and we also want it to be a singleton.

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

const { Services } = Cu.import("resource://gre/modules/Services.jsm", {});
const { Preferences } = Cu.import("resource://gre/modules/Preferences.jsm", {});
const { XPCOMUtils } = Cu.import("resource://gre/modules/XPCOMUtils.jsm", {});

if (typeof console !== "object") {
  XPCOMUtils.defineLazyModuleGetter(this, "console",
                                    "resource://gre/modules/Console.jsm");
}

function fixDesc(desc) {
  return desc.replace(/( |\t|\r|\n)+/g, " ");
}

// We allow the user to say what they are using the addon for and adjust
// certain preferences accordingly.
const userTypes = {
  activeVerbose: {
    title: "Actively looking for issues and want detailed logging",
    description: fixDesc(`
      This will set your log files (even when sync succeeds) to 'Trace'
      (which means they might contain personal information, such as the
      contents of your bookmarks or sites you have visited) and keep those
      logs for 30 days.`),
    prefs: {
      "services.sync.log.appender.file.level": "Trace",
      "services.sync.log.appender.file.maxErrorAge": 30 * 24 * 60 * 60,
      "services.sync.log.appender.file.logOnSuccess": true,
      "services.sync.log.appender.dump": "Trace",
      "services.sync.log.logger": "Trace",
      "services.sync.log.logger.engine": "Trace",
    },
  },

  activeDefault: {
    title: "Actively looking for issues but don't want personal info in my logs",
    description: fixDesc(`
      This will keep your log files to the default settings (so in general
      will not include personal information such as your Bookmarks and History,
      but may include the email address for your Firefox Account), and keep
      those logs for 30 days. Some issues may be difficult to diagnose at this
      log level`),
    prefs: {
      "services.sync.log.appender.file.level": "Trace",
      "services.sync.log.appender.file.maxErrorAge": 30 * 24 * 60 * 60,
      "services.sync.log.appender.dump": "Trace",
      "browser.dom.window.dump.enabled": true,
      "services.sync.log.appender.file.logOnSuccess": true,
    },
  },

  poking: {
    title: "Just poking around and don't want logging options changed",
    description: fixDesc(`
      This will leave all logging options alone.`),
    prefs: {
    },
  },
  custom: {
    title: "I'd prefer to adjust these preferences manually",
  },
};

function getUserTypes() {
  return Object.assign({}, userTypes);
}

let haveReloadedPrefs = false;

function getCurrentUserType() {
  let cur = Preferences.get("extensions.aboutsync.usertype");
  if (!cur || !(cur in userTypes)) {
    cur = "activeVerbose";
  }
  // We always adjust the preferences when starting up as new releases of
  // the addon might set new prefs.
  if (!haveReloadedPrefs) {
    _changeUserType(null, cur);
    haveReloadedPrefs = true;
  }
  return cur;
}

function changeUserType(toId) {
  if (!userTypes[toId]) {
    throw new Error("no such id");
  }
  // First we'll reset all the prefs from the current profile.
  console.log("Changing userType to", toId);
  let cur = getCurrentUserType();
  _changeUserType(cur, toId);
}

function _changeUserType(fromId, toId) {
  if (fromId && userTypes[fromId] && userTypes[fromId].prefs) {
    for (let prefName of Object.keys(userTypes[fromId].prefs)) {
      Preferences.reset(prefName);
      console.log(`resetting pref ${prefName} - now the default of ${Preferences.get(prefName)}`)
    }
  }
  // and setup the new ones if it isn't "custom"
  let to = userTypes[toId];
  if (to.prefs) {
    for (let prefName of Object.keys(to.prefs)) {
      let value = to.prefs[prefName];
      console.log(`setting pref ${prefName} to ${value}`)
      Preferences.set(prefName, value);
    }
  }
  Preferences.set("extensions.aboutsync.usertype", toId);
}

function startoverObserver(subject, topic, data) {
  switch (topic) {
    case "weave:service:start-over:finish":
      // Sync has completed resetting its world.
      haveReloadedPrefs = false;
      getCurrentUserType(); // side-effect is to adjust prefs.
      break;

    default:
      log("unexpected topic", topic);
  }
}

function initialize() {
  // A Preference observer, so we can watch for Sync being reconfigured and
  // readjust all the prefs.
  Services.obs.addObserver(startoverObserver, "weave:service:start-over:finish", false);
}

function finalize() {
  Services.obs.removeObserver(startoverObserver, "weave:service:start-over:finish");
}


this.Config = {getCurrentUserType, getUserTypes, changeUserType,
               initialize, finalize};

this.EXPORTED_SYMBOLS = ["Config"];
