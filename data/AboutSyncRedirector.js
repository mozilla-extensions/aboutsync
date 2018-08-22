"use strict";

this.EXPORTED_SYMBOLS = ["AboutSyncRedirector"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

const INDEX_HTML = "chrome://aboutsync/content/index.html";

const generateQI = XPCOMUtils.generateQI || ChromeUtils.generateQI;

const AboutSyncRedirector = {
  QueryInterface: generateQI([Ci.nsIAboutModule]),
  classID: Components.ID("{decc7a05-f6c6-4624-9e58-176c84d032af}"),

  getURIFlags() {
    // Do we need others?
    return Ci.nsIAboutModule.ALLOW_SCRIPT;
  },

  newChannel(aURI, aLoadInfo) {
    let newURI = Services.io.newURI(INDEX_HTML);
    let channel = Services.io.newChannelFromURIWithLoadInfo(newURI, aLoadInfo);

    channel.originalURI = aURI;

    return channel;
  },

  createInstance(outer, iid) {
    if (outer) {
      throw Components.results.NS_ERROR_NO_AGGREGATION;
    }
    return this.QueryInterface(iid);
  },

  register() {
    const contract = "@mozilla.org/network/protocol/about;1?what=sync";
    const description = "About Sync";
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar)
      .registerFactory(this.classID, description, contract, this);
  },

  unregister() {
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar)
      .unregisterFactory(this.classID, this);
  }
};

