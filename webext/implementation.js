this.aboutsync = class extends ExtensionAPI {
  getAPI(context) {
    return {
      aboutsync: {
        startup() {
          try {
            let bootstrap = context.extension.resourceURL + "ext_bootstrap.js";
            let ns = Cu.import(bootstrap, {});
            ns.startup({context}, null);

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
            context.extension.onShutdown.add(closer);
          } catch (ex) {
            console.error("Failed to initialize about:sync", ex);
          }
        }
      }
    }
  }
}
