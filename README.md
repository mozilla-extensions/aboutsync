# About Sync

This *desktop-only* addon shows information about your Sync account, including showing all
server data for your account. It is designed primarily for Sync developers, or
advanced users who would like insights into their Sync data.

Once installed, type `about:sync` into the URL bar.

[Pull requests are welcome](https://github.com/mozilla-extensions/aboutsync)

# Running from source
This is only possible in Nightly. To proceed, you must use `about:config` to
set `extensions.experiments.enabled=true`.
* Clone the git repo locally.
* Run `npm install` inside the repo.
* Optionally, run `npm run dev` which should start a daemon which means any edits you
  make while Firefox is running should get picked up, and only need a "refresh" rather
  than a full browser restart to be seen.
* In `about:debugging`, load the extension by selecting any file in the root directory (eg, `chrome.manifest`).
* Open `about:sync`

## Other help:
* To see verbose debug messages from bootstrap.js, set a boolean preference
  `extensions.aboutsync.verbose=true` - messages will be sent to the browser
  console. Most non-bootstrap code can just use `console.log()` etc.

# Testing a XPI
The CI process creates "dep signed" XPI files which can be used to test - this is useful to test
the artifact of a PR, or to pre-test a release XPI before final "production signing".

See [the official docs](https://github.com/mozilla-extensions/xpi-manifest/blob/master/docs/testing-a-xpi.md)
but a tl;dr is:
* CI will have a `dep-signed` job which will have the .xpi as an artifact.
* This can be tested *on Nightly only* and only if the preference `xpinstall.signatures.dev-root`
  is true - this pref does not exist by default, so you need to create it as a bool pref.
* As with running from source, you *also need* `extensions.experiments.enabled=true`

# Release Process
Because this addon must be signed by the addons team, the release process is
more difficult than for regular addons.

The general process followed by the addons team is
[documented here](https://github.com/mozilla-extensions/xpi-manifest/blob/master/docs/releasing-a-xpi.md),
but at the current time, the maintainers of about-sync don't have the required
permissions. Therefore, the process is:

* Get everything ready for the new release. Note that the addon version inside
  manifest.json is not used by this process, so it's not strictly necessary
  to bump it.

* Ensure this revision is tested using the [testing process described above](#testing-a-xpi)

* Join the #addons-pipeline slack channel, asking for a release to be built
  specifying the git revision - this will typically be `main`.

* You should be given the link to a "release signing" taskcluster job - in this
  job, look for the built, signed .xpi and download it locally.

* This release signing task should also have created a github tag in the
  [aboutsync repository](https://github.com/mozilla-extensions/aboutsync/tags).
  Check that it has!

* Upload the xpi to addons.mozilla.org. If you don't have the permission for
  this, ask for help in the #addons-pipeline channel.
