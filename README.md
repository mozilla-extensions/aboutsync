# About Sync

This *desktop-only* addon shows information about your Sync account, including showing all
server data for your account. It is designed primarily for Sync developers, or
advanced users who would like insights into their Sync data.

Once installed, type `about:sync` into the URL bar.

[Pull requests are welcome](https://github.com/mozilla-extensions/aboutsync)

# Running from source
This is only possible in Nightly. To proceed, you must use `about:config` to set `extensions.experiments.enabled=true`
* Clone the git repo locally.
* Run `npm install` inside the repo.
* In `about:debugging`, load the extension by selecting any file in the root directory (eg, `chrome.manifest`).
* Open `about:sync`

# Developing
* From a command prompt, run `npm run dev` to start watching
  files in `src` for changes - as you edit files, it should repack and pick up changes - the
  refresh button in `about:debugging` might be needed for some changes.

* To see verbose debug messages from bootstrap.js, set a boolean preference
  `extensions.aboutsync.verbose=true` - messages will be sent to the browser
  console. Most non-bootstrap code can just use `console.log()` etc.

# Release Process

Because this addon must be signed by the addons team, we follow the process
[documented here](https://github.com/mozilla-extensions/xpi-manifest/blob/master/docs/releasing-a-xpi.md)

TODO: more details
