// onInstalled, but not onStartup, is called when the addon is installed.
browser.runtime.onInstalled.addListener(() => {
  if (!browser.aboutsync) {
    // no browser.aboutsync almost certainly means Firefox didn't load our
    // "experimental api", so make noise.
    let msg = "\n\n***** NOTE: about:sync is going to fail to load ****\n" +
              "If you are running this extension locally, it looks alot like you" +
              " need to set the preference `extensions.experiments.enabled` to `true`" +
              " before things will work for you. Note that this preference can" +
              " only be changed in Nightly\n\n";
    console.error(msg);
    dump(msg);
  }
  browser.aboutsync.startup();
});
// onStartup is called at browser startup if the addon is already installed.
browser.runtime.onStartup.addListener(() => {
  browser.aboutsync.startup();
});

function bookmarkTabs(msg, sender, sendRes){
  console.log(msg.device)
  browser.bookmark.create({title:'test'})
}

browser.runtime.onMessage.addListener(bookmarkTabs);
