browser.runtime.onInstalled.addListener(() => {
  browser.aboutsync.startup();
});
