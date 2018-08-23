this.aboutsync = class extends ExtensionAPI {
  // Ideally we'd be able to implement onUninstall and onUpdate static methods,
  // as described in
  // https://firefox-source-docs.mozilla.org/toolkit/components/extensions/webextensions/lifecycle.html
  // However, this doesn't work for "experiment" APIs - see bug 1485541.

  getAPI(context) {
    return {
      aboutsync: {
        startup() {
          try {
            let bootstrap = context.extension.resourceURL + "ext_bootstrap.js";
            let ns = Cu.import(bootstrap, {});
            try {
              ns.startup({context}, null);
            } catch (ex) {
              console.error("FAILED to initialize", ex);
              // but we continue to add the closer function so we can
              // reinitialize (which only makes sense while developing the
              // addon)
            }

            // This is the only sane way I can see to register for shutdown!
            let closer = {
              close: () => {
                try {
                  ns.shutdown({context}, null);
                } catch (ex) {
                  console.error("FAILED to shutdown", ex);
                }
                ns = null;
                Cu.unload(bootstrap);

              }
            }
            context.extension.callOnClose(closer);
          } catch (ex) {
            console.error("Failed to initialize about:sync", ex);
          }
        }
      }
    }
  }
}
