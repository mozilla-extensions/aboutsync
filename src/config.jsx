// Components and other code for managing the friendlier Sync prefs management
// offered by this addon.

const React = require("react");
const { Fetching, InternalAnchor } = require("./common");

const { Log } = ChromeUtils.importESModule("resource://gre/modules/Log.sys.mjs");
const { Preferences } = ChromeUtils.importESModule("resource://gre/modules/Preferences.sys.mjs");
const { FileUtils } = ChromeUtils.importESModule("resource://gre/modules/FileUtils.sys.mjs");
const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
const { Config } = ChromeUtils.importESModule("chrome://aboutsync/content/config.js");
const { Panel, PanelGroup } = require("./panel");
const { Weave } = ChromeUtils.importESModule("resource://services-sync/main.sys.mjs");

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

        <LogLevelComponent label="Level of messages written to the Browser Console - useful for live debugging, when a log file isn't always flushed"
                           prefs={["services.sync.log.appender.console"]}/>

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

  // Makes a simple .zip file with a single file in it.
  async zipOneFile(zipFile, filename) {
    let zipWriter = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);

    console.log("Creating zip", zipFile.path);
    // *sob*
    const PR_RDWR        = 0x04;
    const PR_CREATE_FILE = 0x08;
    const PR_TRUNCATE    = 0x20;

    zipWriter.open(zipFile, PR_RDWR | PR_CREATE_FILE | PR_TRUNCATE);

    let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(filename);
    zipWriter.addEntryFile(file.leafName,
                             Ci.nsIZipWriter.COMPRESSION_DEFAULT,
                             file, false);
    zipWriter.close();
  }

  async downloadFile(sourceFileURI, targetFilename) {
    let downloadsDir = await Downloads.getPreferredDownloadsDirectory();
    let filename = await PathUtils.join(downloadsDir, targetFilename);
    // need to nuke an existing file first.
    if ((await IOUtils.exists(filename))) {
      await IOUtils.remove(filename);
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

  async _makeCombined() {
    let files = this._getOrderedLogFiles();
    this.setState({
      downloadingCombined: {
        current: 0,
        total: files.length
      }
    });

    let combinedFilePath = PathUtils.join(PathUtils.tempDir, "aboutsync-combined-log.txt");
    // need to nuke an existing file first.
    if ((await IOUtils.exists(combinedFilePath))) {
      await IOUtils.remove(combinedFilePath);
    }

    try {
      let textEncoder = new TextEncoder();
      // as in cstdio
      async function puts(string) {
        return await IOUtils.write(combinedFilePath, textEncoder.encode(string + "\n"), {mode: "appendOrCreate"});
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
        let entireFile = await IOUtils.readUTF8(entry.path);
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
    } catch (err) {
      console.error("Error combining logs: ", err);
    }
    this.setState({
      downloadingCombined: {
        current: files.length,
        total: files.length
      }
    });
    return combinedFilePath;
  }

  async downloadCombinedAsText(event) {
    event.preventDefault();
    try {
      let filename = await this._makeCombined();
      await this.downloadFile(PathUtils.toFileURI(filename), "aboutsync-combined-log.txt");
    } catch (e) {
      console.error("Failed to download combined", e);
    }
    this.setState({
      downloadingCombined: null
    });
  }

  async downloadCombinedAsZip(event) {
    event.preventDefault();
    try {
      let filename = await this._makeCombined();

      // Create the zip file in ${TempDir}/mozilla-temp-files
      let dir = FileUtils.getDir("TmpD", ["mozilla-temp-files"]);
      let zipFile = new FileUtils.File(PathUtils.join(dir.path,  "aboutsync-combined-log.zip"));
      await this.zipOneFile(zipFile, filename)
      // Now "download" it
      await this.downloadFile(Services.io.newFileURI(zipFile), "aboutsync-combined-log.zip");
    } catch(err) {
      console.error("Failed to download zipfile", err);
    }
    this.setState({
      downloadingCombined: null
    });
  }

  flushLog(event) {
    let eh = Weave.Service.errorHandler;
    eh._log.info("about:sync flushing log file due to user request");
    eh.resetFileLog().catch(err => {
      console.error("Failed to flush the log", err);
    }).then(() => {
      this.reload();
    });
  }

  removeAllLogs(event) {
    const { logManager } = ChromeUtils.importESModule("resource://gre/modules/FxAccountsCommon.sys.mjs");
    logManager.removeAllLogs().catch(err => {
      console.error("Failed to flush the log", err);
    }).then(() => {
      let eh = Weave.Service.errorHandler;
      eh._log.info("about:sync removed all logs due to user request");
      this.reload();
    });
  }

  writeCustomLogEntry(event) {
    let text = window.prompt("Enter something to write to the log files");
    if (text) {
      let eh = Weave.Service.errorHandler;
      eh._log.info(`about:sync custom log entry: ${text}`);
    }
  }

  async componentDidMount() {
    this.reload();
  }

  async reload() {
    // find all our log-files.
    let logDir = FileUtils.getDir("ProfD", ["weave", "logs"]);
    let result = {
      entries: [],
      numErrors: 0,
    }
    try {
      let iterator = await IOUtils.getChildren(logDir.path);
      iterator.forEach(entry => {
        // IOUtils gives us the absolute path, but LOG_FILE_RE
        // and other operations operate on the filename
        let fileName = /[^/]*$/.exec(entry)[0];
        result.entries.push({name: fileName, path: entry});
        result.numErrors += fileName.startsWith("error-") ? 1 : 0;
      });
    } catch(err) {
      console.error("Failed to fetch the logfiles", err);
    }
    // Update the state
    this.setState({ logFiles: result });
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

    let logActions;
    if (logFiles.entries.length == 0) {
      logActions = <div><span>No news is good news; there are no log files</span></div>;
    } else {
      // summarize them - by default, they will all be errors.
      logActions = <>
        <div>
          <span>{logFiles.numErrors} error logs, {logFiles.entries.length} in total - </span>
          <InternalAnchor href="about:sync-log">view them locally</InternalAnchor>
        </div>
        <div>
          {this.state.downloadingCombined ? (
            <span>{this._processing("combined log file", this.state.downloadingCombined)}</span>
          ) : (
          <span>download a combined summary <a href="#" onClick={event => this.downloadCombinedAsText(event)}>as a text file</a> or <a href="#" onClick={event => this.downloadCombinedAsZip(event)}>as a zip file</a></span>
          )}
        </div>
      </>
    };

    return (
      <div>
        {logActions}
        <div>
          <button className="action-button" onClick={event => this.flushLog(event)}>
            Force a new (probably empty) log now
          </button>
        </div>
        <div>
          <button className="action-button" onClick={event => this.removeAllLogs(event)}>
            Permanently remove all log files
          </button>
        </div>
        <div>
          <button className="action-button" onClick={event => this.writeCustomLogEntry(event)}>
            Write a custom log entry
          </button>
        </div>
      </div>
    );
  }

  render() {
    return this.renderSummary();
  }
}

// Options for the addon itself.
function AddonPrefsComponent() {
  return (
    <PrefCheckbox label="Hide notification on sync errors"
                  pref="extensions.aboutsync.hideNotifications"/>
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
      </div>
    );
  }
}

// The top-level options.
function ConfigComponent() {
  return (
    <PanelGroup>
      <Panel title="General Options" open>
        <UserType/>
      </Panel>

      <Panel title="Log Files and Diagnostics">
        <LogFilesComponent/>
      </Panel>

      <Panel title="Other Options">
        <AddonPrefsComponent/>
        <p/>
        <InternalAnchor href="about:preferences#sync">
          Open Sync Preferences
        </InternalAnchor>
      </Panel>
    </PanelGroup>
  );
}

module.exports = { ConfigComponent, PrefCheckbox };
