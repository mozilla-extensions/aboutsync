// Components and other code for managing the friendlier Sync prefs management
// offered by this addon.

const React = require("react");
const { Fetching, InternalAnchor, importLocal } = require("./common");

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

const { Log } = importLocal("resource://gre/modules/Log.jsm");
const { Preferences } = importLocal("resource://gre/modules/Preferences.jsm");
const { FileUtils } = importLocal("resource://gre/modules/FileUtils.jsm");
const { OS } = importLocal("resource://gre/modules/osfile.jsm");
const { Downloads } = importLocal("resource://gre/modules/Downloads.jsm");
const { Services } = importLocal("resource://gre/modules/Services.jsm");
const { Config } = importLocal("chrome://aboutsync/content/config.js");

// For our "Sync Preferences" support.
// A "log level" <select> element.
class LogLevelSelectComponent extends React.Component {
  handleChange(event) {
    for (let pref of this.props.prefs) {
      Preferences.set(pref, event.target.value);
    }
    // The state for these prefs are external (ie, in the Fx prefs store), so
    // force an update.
    this.forceUpdate();
  }

  render() {
    // We just take the value for the first pref (if there are multiple prefs
    // for this object we are just making them all be the same value)
    let prefName = this.props.prefs[0];
    let prefValue = Preferences.get(prefName);
    let names = Object.keys(Log.Level).filter(n => typeof Log.Level[n] == "number");
    return (
      <select value={prefValue} onChange={event => this.handleChange(event)}>
        {names.map(n =>
          <option value={n} key={n}>{n}</option>
        )}
      </select>
    );
  }
}

function LogLevelComponent({prefs, label}) {
  return (
    <div className="logLevel">
      <span>{label}</span>
      <LogLevelSelectComponent prefs={prefs}/>
    </div>
  );
}

// A checkbox that's (poorly) tied to a Firefox preference value.
// Ideally we'd use an observer and be better integrated with react's state
// support so these update on-the-fly if changed externally - later!
class PrefCheckbox extends React.Component {
  handleChange(event) {
    Preferences.set(this.props.pref, event.target.checked);
    // The state for these prefs are external (ie, in the Fx prefs store), so
    // force an update.
    this.forceUpdate();
  }

  render() {
    let checked = !!Preferences.get(this.props.pref, this.props.defaultValue);
    return (
      <label>
        <input type="checkbox"
               checked={checked}
               onChange={event => this.handleChange(event)}/>
        {this.props.label}
      </label>
    );
  }
}

// A textbox that allows a "number of days" pref value that's (poorly) tied
// to a Firefox preference value.
class NumDaysInput extends React.Component {
  handleChange(event) {
    let numberOfDays = parseInt(event.target.value);
    if (!isNaN(numberOfDays)) {
      let numberOfSeconds = numberOfDays * 24 * 60 * 60;
      Preferences.set(this.props.pref, numberOfSeconds);
    }
    // The state for these prefs are external (ie, in the Fx prefs store), so
    // force an update.
    this.forceUpdate();
  }

  render() {
    let numberOfSeconds = Preferences.get(this.props.pref);
    let numberOfDays = Math.floor(numberOfSeconds / 60 / 60 / 24);
    let checked = !!Preferences.get(this.props.pref);
    let props = { type: "text", value: numberOfDays, onChange: event => this.handleChange(event) };
    return (
      <div>
        <label>
          {this.props.label}
          <input type="text" value={numberOfDays} onChange={event => this.handleChange(event)}/>
        </label>
      </div>
    );
  }
}

const ENGINE_PREFS = [
  "services.sync.log.logger.engine.addons",
  "services.sync.log.logger.engine.apps",
  "services.sync.log.logger.engine.bookmarks",
  "services.sync.log.logger.engine.clients",
  "services.sync.log.logger.engine.forms",
  "services.sync.log.logger.engine.history",
  "services.sync.log.logger.engine.passwords",
  "services.sync.log.logger.engine.prefs",
  "services.sync.log.logger.engine.tabs",
];

// The general "logging config" component.
class LoggingConfig extends React.Component {
  render() {
    return (
      <div>
        <LogLevelComponent label="Level of messages written by Sync engines"
                           prefs={ENGINE_PREFS}/>

        <LogLevelComponent label="Level of messages written to about:sync-logs log files"
                           prefs={["services.sync.log.appender.file.level"]}/>

        <LogLevelComponent label="Level of messages written to dump - useful primarily for developers"
                           prefs={["services.sync.log.appender.dump"]}/>

        <NumDaysInput label="Number of days to keep log files for:"
                      pref="services.sync.log.appender.file.maxErrorAge"/>

        <div>
          <PrefCheckbox label="Create log files even on success?"
                        pref="services.sync.log.appender.file.logOnSuccess"/>
        </div>

        <div>
          <PrefCheckbox label="Remember these values when Sync is reconfigured?"
                        pref="extensions.aboutsync.applyOnStartOver"/>
        </div>
      </div>
    );
  }
}

// Matches logfiles, captures timestamp.
const LOG_FILE_RE = /^\w+-\w+-(\d+)\.txt$/;

// Format a ms-since-1970 timestamp as a string that will be consistent across
// locales
function timestampToTimeString(ts) {
  // toISOString() throws for invalid dates.
  try {
    let d = new Date(+ts);
    let s = d.toISOString();
    return s.replace("T", " ").replace("Z", "");
  } catch (e) {
    return `<Illegal Date ${ts}>`;
  }
}

function formatMS(ts) {
  let ms = String(ts % 1000).padStart(3, "0");
  let sec = String(Math.floor(ts / 1000) % 60).padStart(2, "0");
  let min = String(Math.floor(ts / (1000 * 60)) % 60).padStart(2, "0");
  let hrs = String(Math.floor(ts / (1000 * 60 * 60))).padStart(2, "0");
  return `${hrs}:${min}:${sec}.${ms}`;
}

// The main component for managing log files - also enumerates the file-system
// for the individual files and can create a .zip file from the,
class LogFilesComponent extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      logFiles: null,
      downloadingCombined: null
    };
  }

  // Makes a simple .zip file and "downloads" it.
  // NOTE that this could possibly be improved by concatenating all log files
  // in "last modified" order into a single txt file, along with other
  // diagnostic ifo, ready for upload into bugzilla - that would make it
  // easier for the developer to peruse and get a complete picture of the session.

  // Eg, I could see the file being of the form:
  // ---- 8< ---- cut here ---- 8< ----
  // [addons]
  // { dynamically generated list of addons here. }
  // [preferences]
  // { dynamically generated list of about:troubleshooting preferences here. }
  // ...
  // [log logfilename]
  // { contents of the first logfile }
  // [log logfilename]
  // etc.

  // But for now it is just a simple .zip file of every log file we could find.
  async downloadZipFile(event) {
    event.preventDefault();
    let logFilenames = [];
    let zipWriter = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);

    // Create the file in ${TempDir}/mozilla-temp-files
    let zipFile = FileUtils.getFile("TmpD",
      ["mozilla-temp-files", "aboutsync-logfiles.zip"]);
    console.log("Creating zip", zipFile.path);
    // *sob*
    const PR_RDWR        = 0x04;
    const PR_CREATE_FILE = 0x08;
    const PR_TRUNCATE    = 0x20;

    zipWriter.open(zipFile, PR_RDWR | PR_CREATE_FILE | PR_TRUNCATE);

    for (let entry of this.state.logFiles.entries) {
      let logfile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      logfile.initWithPath(entry.path);
      zipWriter.addEntryFile(logfile.leafName,
                             Ci.nsIZipWriter.COMPRESSION_DEFAULT,
                             logfile, false);
    }
    zipWriter.close();
    // Now start the "download" of the file.
    // This seems much more difficult than it should be!
    try {
      await this.downloadFile(Services.io.newFileURI(zipFile), "aboutsync-logfiles.zip");
    } catch(err) {
      console.error("Failed to download zipfile", err);
    }
  }

  async downloadFile(sourceFileURI, targetFilename) {
    let downloadsDir = await Downloads.getPreferredDownloadsDirectory();
    let filename = await OS.Path.join(downloadsDir, targetFilename);
    // need to nuke an existing file first.
    if ((await OS.File.exists(filename))) {
      await OS.File.remove(filename);
    }
    let download = await Downloads.createDownload({
      source: sourceFileURI,
      target: filename,
    });
    // Add it to the "downloads" list.
    let list = await Downloads.getList(Downloads.PUBLIC);
    list.add(download);
    await download.start();
    // Show the file in Explorer/Finder/etc
    await download.showContainingDirectory();
  }

  // Oldest first, filters out ones that don't match LOG_FILE_RE
  _getOrderedLogFiles() {
    return this.state.logFiles.entries
    .filter(entry => {
      if (entry.isDir || entry.isSymLink) {
        return false;
      }
      let m = entry.name.match(LOG_FILE_RE);
      if (!m) {
        return false;
      }
      return !isNaN(+m[1])
    }).sort((a, b) => {
      return (+a.name.match(LOG_FILE_RE)[1]) - (+b.name.match(LOG_FILE_RE)[1])
    });
  }

  async _downloadCombined() {
    let files = this._getOrderedLogFiles();
    this.setState({
      downloadingCombined: {
        current: 0,
        total: files.length
      }
    });

    let tmpFileInfo = await OS.File.openUnique(
      OS.Path.join(OS.Constants.Path.tmpDir, "aboutsync-combined-log.txt"))

    try {
      let textEncoder = new TextEncoder();
      // as in cstdio
      async function puts(string) {
        return tmpFileInfo.file.write(textEncoder.encode(string + "\n"));
      }

      await puts(`Processing ${files.length} files`);
      let idx = 0;
      for (let entry of files) {
        let writeDate = entry.name.match(LOG_FILE_RE)[1];
        await puts(`\nLog file: ${entry.name} (written on ${timestampToTimeString(writeDate)})`);
        this.setState({
          downloadingCombined: {
            current: ++idx,
            total: files.length
          }
        });
        let entireFile = await OS.File.read(entry.path, { encoding: "UTF-8" });
        let entireFileLines = entireFile.split("\n");

        if (entireFileLines.length == 0) {
          // Shouldn't happen.
          await puts("File is empty!");
          continue;
        }

        // This should usually/always be on the first line.
        let firstTimestamp = +entireFileLines.find(line => line.split("\t")[0]).split("\t")[0];

        // Fake buffered input. await puts() for each line is far too slow.
        let outLines = [`First timestamp: ${firstTimestamp} (${timestampToTimeString(firstTimestamp)})`];

        for (let line of entireFileLines) {
          // Indent these lines so that text editors like sublime text will be
          // able to collapse the whole file from the sidebar.
          try {
            let [ts, ...rest] = line.split("\t");
            let diff = Number(ts) - firstTimestamp;
            outLines.push(`  ${timestampToTimeString(ts)} (${formatMS(diff)})    ${rest.join("\t")}`);
          } catch (e) {
            outLines.push(`  ${line}`);
          }
        }
        await puts(outLines.join("\n"));
      }
    } finally {
      await tmpFileInfo.file.close();
    }
    this.setState({
      downloadingCombined: {
        current: files.length,
        total: files.length
      }
    });

    await this.downloadFile(OS.Path.toFileURI(tmpFileInfo.path), "aboutsync-combined-log.txt");
  }

  async downloadCombined(event) {
    event.preventDefault();
    try {
      await this._downloadCombined();
    } catch (e) {
      console.error("Failed to download combined", e);
    }
    this.setState({
      downloadingCombined: null
    });
  }

  componentDidMount() {
    // find all our log-files.
    let logDir = FileUtils.getDir("ProfD", ["weave", "logs"]);
    let iterator = new OS.File.DirectoryIterator(logDir.path);

    let result = {
      entries: [],
      numErrors: 0,
    }
    iterator.forEach(entry => {
      result.entries.push(entry);
      result.numErrors += entry.name.startsWith("error-") ? 1 : 0;
    }).then(() => {
      this.setState({ logFiles: result });
    }).catch(err => {
      console.error("Failed to fetch the logfiles", err);
    });
  }

  _processing(kind, {current, total}) {
    if (current == total) {
      return `finishing ${kind}`
    } else {
      return `processing ${kind} (${current} / ${total})`
    }
  }

  renderSummary() {
    let logFiles = this.state.logFiles;
    if (!logFiles) {
      return <Fetching label="Looking for log files..."/>;
    }
    if (!logFiles.entries.length) {
      return <span>No news is good news; there are no log files</span>;
    }
    // summarize them - by default, they will all be errors.
    return (
      <div>
        <span>{logFiles.numErrors} error logs, {logFiles.entries.length} in total - </span>
        <InternalAnchor href="about:sync-log">view them locally</InternalAnchor>
        <span>, </span>
        {this.state.downloadingCombined ? (
          <span>{this._processing("combined log file", this.state.downloadingCombined)}</span>
        ) : (
          <a href="#" onClick={event => this.downloadCombined(event)}>
            download a combined summary
          </a>
        )}
        <span>, or </span>
        <a href="#" onClick={event => this.downloadZipFile(event)}>
          download them as a zip file
        </a>
      </div>
    );
  }

  render() {
    return (
      <fieldset>
        <legend>Log Files</legend>
        {this.renderSummary()}
      </fieldset>
    );
  }
}

// Options for the addon itself.
function AddonPrefsComponent() {
  return (
    <fieldset>
      <legend>Addon Options</legend>
      <PrefCheckbox label="Hide notification on sync errors"
                    pref="extensions.aboutsync.hideNotifications"/>
    </fieldset>
  );
}

// A "user profile" (but we call it a "user type" as profile is too overloaded)
class UserType extends React.Component {
  constructor(props) {
    super(props);
    this.state = {value: Config.getCurrentUserType()};
  }

  handleChange(event) {
    Config.changeUserType(event.target.value);
    this.setState({value: Config.getCurrentUserType()});
  }

  render() {
    // An array with the IDs in the content.
    let ut = Config.getUserTypes();
    let options = [];
    for (let id of Object.keys(ut)) {
      options.push(Object.assign({id}, ut[id]));
    }
    return (
      <div>
        Please describe how you intend using about:sync<br/>
        <select value={this.state.value} onChange={event => this.handleChange(event)}>
          {options.map(n =>
            <option value={n.id} key={n.id}>{n.title}</option>
          )}
        </select>
        <div>
          <p>{ut[this.state.value].description}</p>
        </div>
        {this.state.value == "custom" ? (<LoggingConfig/>) : null}
        <LogFilesComponent/>
      </div>
    );
  }
}

// The top-level options.
function ConfigComponent() {
  return (
    <div className="config">
      <UserType/>
      <AddonPrefsComponent/>
    </div>
  );
}

module.exports = { ConfigComponent, PrefCheckbox };
