this.aboutsync = class extends ExtensionAPI {
  // Ideally we'd be able to implement onUninstall and onUpdate static methods,
  // as described in
  // https://firefox-source-docs.mozilla.org/toolkit/components/extensions/webextensions/lifecycle.html
  // However, this doesn't work for "experiment" APIs - see bug 1485541.

  getAPI(context) {
    return {
      aboutsync: {
        async startup() {
          try {
            let bootstrap = context.extension.resourceURL + "ext_bootstrap.js";
            // We can't Cu.import() this because it's not resource:// or chrome://, but we can
            // load and eval it.
            let script = await ChromeUtils.compileScript(bootstrap);
            // Probably not strictly necessary to use a custom sandbox here, but it can't hurt.
            let ns = Cu.Sandbox(
              Services.scriptSecurityManager.getSystemPrincipal(),
              {
                sandboxName: `sandbox for about:sync's implementation`,
                wantGlobalProperties: ["ChromeUtils"],
              }
            );
            script.executeInGlobal(ns);
            try {
              ns.AboutSyncBootstrap.startup({context}, null);
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
