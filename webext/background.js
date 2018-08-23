// onInstalled, but not onStartup, is called when the addon is installed.
browser.runtime.onInstalled.addListener(() => {
  browser.aboutsync.startup();
});
// onStartup is called at browser startup if the addon is already installed.
browser.runtime.onStartup.addListener(() => {
  browser.aboutsync.startup();
});
