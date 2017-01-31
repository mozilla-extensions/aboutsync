# About Sync

This addon shows information about your Sync account, including showing all
server data for your account. It is designed primarily for Sync developers, or
advanced users who would like some insights into their Sync data.

Once installed, you can either select "About Sync" from the tools menu, or
just paste chrome://aboutsync/content/index.html into a tab.

The source code is at https://github.com/mhammond/aboutsync and pull requests
are welcome!

# Development

The easiest way to develop/debug this is:

* Clone the git repo locally.
* In about:debugging, Load the extension by selecting the
  `chrome.manifest` file
* Open chrome://aboutsync/content/index.html (or use the new "About
  Sync" entry created in the "Tools" menu)
* When using the addon this way, you can make changes to the
  HTML/CSS/JS and press the refresh button in the `about:debugging`
  panel. It will be picked up automatically.

Other notes:
* To see verbose debug messages from bootstrap.js, create a boolean preference
  "extensions.aboutsync.verbose" to true - message will be sent to the browser
  console. Note that console.log etc can be used in the "data" JS.
