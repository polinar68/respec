/**
 * Exports fetchAndWrite() method, allowing programmatic control of the
 * spec generator.
 *
 * For usage, see example a https://github.com/w3c/respec/pull/692
 */
/*jshint node: true, browser: false*/
"use strict";
const async = require("marcosc-async");
const os = require("os");
const Nightmare = require("nightmare");
const colors = require("colors");
const fsp = require("fs-promise");
const fs = require("fs");
const path = require("path");
const parseURL = require("url").parse;
colors.setTheme({
  debug: "cyan",
  error: "red",
  warn: "yellow",
});
const tasks = {
  /**
   * Writes "data" to a particular outPath as UTF-8.
   * @private
   * @param  {String} outPath The relative or absolute path to write to.
   * @param  {String} data    The data to write.
   * @return {Promise}        Resolves when writing is done.
   */
  writeTo(outPath, data) {
    return async.task(function* () {
      let newFilePath = "";
      if (path.isAbsolute(outPath)) {
        newFilePath = outPath;
      } else {
        newFilePath = path.resolve(process.cwd(), outPath);
      }
      try {
        yield fsp.writeFile(newFilePath, data, "utf-8");
      } catch (err) {
        console.error(err, err.stack);
        process.exit(1);
      }
    });
  },
  /**
   * Makes a temporary directory.
   *
   * @private
   * @param  {String} prefix The prefix to use, to distinguish it from other tmp
   *                         directories.
   * @return {Promise}       Resolves if dir is created; rejects otherwise.
   */
  makeTempDir(prefix) {
    return new Promise((resolve, reject) => {
      fs.mkdtemp(prefix, (err, folder) => {
        return (err) ? reject(err) : resolve(folder);
      });
    });
  },
  /**
   * Fetches a ReSpec "src" URL, processes via NightmareJS and writes it to an
   * "out" path within a given "timeout".
   *
   * @public
   * @param  {String} src        A URL that is the ReSpec source.
   * @param  {String|null} out   A path to write to. If null, goes to stdout.
   * @param  {Object} whenToHalt Object with two bool props (haltOnWarn,
   *                             haltOnError), allowing execution to stop
   *                             if either occurs.
   * @param  {Number} timeout    Optional. Milliseconds before NightmareJS
   *                             should timeout.
   * @return {Promise}           Resolves with HTML when done writing.
   *                             Rejects on errors.
   */
  fetchAndWrite(src, out, whenToHalt, timeout){
    return async.task(function* () {
      const userData = yield this.makeTempDir(os.tmpDir() + "/respec2html-");
      const nightmare = new Nightmare({
        show: false,
        timeout,
        webPreferences: {
          "images": false,
          "defaultEncoding": "utf-8",
          userData,
        }
      });
      nightmare.useragent("respec2html");
      const url = parseURL(src).href;
      const handleConsoleMessages = makeConsoleMsgHandler(nightmare);
      handleConsoleMessages(whenToHalt);
      const html = yield nightmare
        .goto(url)
        .wait(function () {
          return document.respecDone;
        })
        .wait("#respec-modal-save-snapshot")
        .click("#respec-modal-save-snapshot")
        .wait(100)
        .evaluate(function () {
          var encodedText = document.querySelector("#respec-save-as-html").href;
          var decodedText = decodeURIComponent(encodedText);
          var cleanedUpText = decodedText.replace(/^data:text\/html;charset=utf-8,/, "");
          return cleanedUpText;
        })
        .end();
      if (!out) {
        process.stdout.write(html);
        return html;
      }
      try {
        yield this.writeTo(out, html);
        return html;
      } catch (err) {
        console.error(err.stack);
        process.exit(1);
      }
    }, this);
  }
};

/**
 * Handles messages from the browser's Console API.
 *
 * @param  {Nightmare} nightmare Instance of Nightmare to listen on.
 * @return {Function}
 */
function makeConsoleMsgHandler(nightmare) {
  /**
   * Specifies what to do when the browser emits "error" and "warn" console
   * messages.
   *
   * @param  {Object} whenToHalt Object with two bool props (haltOnWarn,
   *                             haltOnError), allowing execution to stop
   *                             if either occurs.
   * @return {Void}
   */
  return function handleConsoleMessages(whenToHalt) {
    nightmare.on("console", (type, message) => {
      const abortOnWarning = whenToHalt.haltOnWarn && type === "warn";
      const abortOnError = whenToHalt.haltOnError && type === "error";
      const output = `ReSpec ${type}: ${colors.debug(message)}`;
      switch (type) {
      case "error":
        console.error(colors.error(`😱 ${output}`));
        break;
      case "warn":
        // Ignore Nightmare's poling of respecDone
        if (/document\.respecDone/.test(message)) {
          return;
        }
        console.error(colors.warn(`😳 ${output}`));
        break;
      }
      if (abortOnError || abortOnWarning) {
        nightmare.proc.kill();
        process.exit(1);
      }
    });
  };
}
exports.fetchAndWrite = tasks.fetchAndWrite.bind(tasks);
