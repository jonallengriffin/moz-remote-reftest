/* -*- Mode: Java; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- /
/* vim: set shiftwidth=4 tabstop=8 autoindent cindent expandtab: */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Mozilla's layout acceptance tests.
 *
 * The Initial Developer of the Original Code is the Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   L. David Baron <dbaron@dbaron.org>, Mozilla Corporation (original author)
 *   Jonathan Griffin <jgriffin@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const CC = Components.classes;
const CI = Components.interfaces;
const CR = Components.results;

const XHTML_NS = "http://www.w3.org/1999/xhtml";

const EXTENSION_ID = "remote-reftest@mozilla.org";

const NS_LOCAL_FILE_CONTRACTID = "@mozilla.org/file/local;1";
const IO_SERVICE_CONTRACTID = "@mozilla.org/network/io-service;1";
const DEBUG_CONTRACTID = "@mozilla.org/xpcom/debug;1";
const NS_LOCALFILEINPUTSTREAM_CONTRACTID =
          "@mozilla.org/network/file-input-stream;1";
const NS_SCRIPTSECURITYMANAGER_CONTRACTID =
          "@mozilla.org/scriptsecuritymanager;1";
const NS_REFTESTHELPER_CONTRACTID =
          "@mozilla.org/reftest-helper;1";
const NS_NETWORK_PROTOCOL_CONTRACTID_PREFIX =
          "@mozilla.org/network/protocol;1?name=";
const NS_XREAPPINFO_CONTRACTID =
          "@mozilla.org/xre/app-info;1";
const NS_WINDOW_MEDIATOR = "@mozilla.org/appshell/window-mediator;1";

const EXTENSION_START_URL =
      "chrome://remote-reftest/content/start-testing.html";

var gLoadTimeout = 0;

// "<!--CLEAR-->"
const BLANK_URL_FOR_CLEARING = "data:text/html,%3C%21%2D%2DCLEAR%2D%2D%3E";

var gBrowser;
var gCanvas1, gCanvas2;
// gCurrentCanvas is non-null between InitCurrentCanvasWithSnapshot and the next
// DocumentLoaded.
var gCurrentCanvas = null;
var gURLs;
// Map from URI spec to the number of times it remains to be used
var gURIUseCounts;
// Map from URI spec to the canvas rendered for that URI
var gURICanvases;
var gParentBrowser = GetBrowserByUrl(EXTENSION_START_URL);
var gTestResults;
var gTotalTests = 0;
var gState;
var gCurrentURL;
var gFailureTimeout = null;
var gFailureReason;
var gCount = 0;
var gAssertionCount = 0;
// The total number of manifest files that need to be read.
var gManifestCount = 1; 
// The number of manifest files that have been read.
var gManifestsRead = 0;

var gIOService;
var gDebug;
var gWindowUtils;

var gCurrentTestStartTime;
var gSlowestTestTime = 0;
var gSlowestTestURL;
var gClearingForAssertionCheck = false;

const EXPECTED_PASS = 0;
const EXPECTED_FAIL = 1;
const EXPECTED_RANDOM = 2;
const EXPECTED_DEATH = 3;  // test must be skipped to avoid e.g. crash/hang
const EXPECTED_LOAD = 4; // test without a reference (just test that it does
                         // not assert, crash, hang, or leak)

var gLogFile = {
  _converter : null,
  _foStream: null,
  _file: null,
  init: function gLogfi(dir) {
    // Get an nsIFile...
    this._file = CC["@mozilla.org/file/local;1"]
                 .createInstance(CI.nsILocalFile);
    this._file.initWithPath(dir);
    this._file.append("results.log");
    var exists = this._file.exists();

    // Make a file output stream and converter to handle it
    this._foStream = CC["@mozilla.org/network/file-output-stream;1"]
                   .createInstance(CI.nsIFileOutputStream);
    var fileflags = gTestResults.ThisChunkStartTest && exists ?
      0x02 | 0x10 : 0x02 | 0x08 | 0x20;
    this._foStream.init(this._file, fileflags, 0666, 0);
    this._converter = CC["@mozilla.org/intl/converter-output-stream;1"]
                    .createInstance(CI.nsIConverterOutputStream);
    this._converter.init(this._foStream, "UTF-8", 0, 0);
  },
  write: function gLogfw(data) {
    this._converter.writeString(data);
  },
  close: function gLogfc() {
    this._converter.close();
  }
};

/**
 * The current test results are sent back to the extension's start HTML page,
 * so that they can be retained between reftest window re-openings.  The
 * results are stored in JSON format in an attribute to a hidden element
 * on that page, and then a custom event is sent to the page notifying it
 * that the data has been updated.
 */
function SendTestResults() {
  try {
    var elm = gParentBrowser.contentDocument.getElementById("listen");
    elm.setAttribute("data", JSON.stringify(gTestResults));
    var evt = gParentBrowser.contentDocument.createEvent("Events");
    evt.initEvent("dataevent", true, false);
    elm.dispatchEvent(evt);
  }
  catch (e) {
    // user closed the reftest HTML page?
    gBrowser.contentWindow.close();
  }  
}

/**
 * Return the browser object which is displaying a given url. This is
 * used to find the browser displaying the extension's start HTML page.
 */
function GetBrowserByUrl(url) {
    var wm = CC[NS_WINDOW_MEDIATOR].getService(CI.nsIWindowMediator);
    var browserEnumerator = wm.getEnumerator("navigator:browser");

    // Check each browser instance for our URL
    var found = false;
    while (!found && browserEnumerator.hasMoreElements()) {
        var browserWin = browserEnumerator.getNext();
        var tabbrowser = browserWin.getBrowser();

        // Check each tab of this browser instance
        var numTabs = tabbrowser.browsers.length;
        for(var index=0; index<numTabs; index++) {
            var currentBrowser = tabbrowser.getBrowserAtIndex(index);
            if (url == currentBrowser.currentURI.spec) {
                return currentBrowser;
            }
        }
    }
    return false;
}

function dumpEx(data) {
  try {
    // Log fail and summary info to the reftest HTML page.
    var bdoc = gParentBrowser.contentDocument;
    if (bdoc) {
      if (data.indexOf("REFTEST TEST-UNEXPECTED-FAI") == 0 ||
        data.indexOf("REFTEST INFO") == 0 ||
        data.indexOf("EXCEPTION") != -1) {
          var ldata = bdoc.createElement("p");
          ldata.innerHTML = data;
          bdoc.getElementById("results").appendChild(ldata);
      }
        
      if (data.length < 500) {
        var logdiv = bdoc.getElementById("log");
        var loglines = logdiv.innerHTML.split("<br>");
        while (loglines.length > 10) {
          loglines.shift();
        }
        loglines.push(data);
        logdiv.innerHTML = loglines.join("<br>");
      }
    }
  }
  catch (e) {}

  // Write log msg to log file and console.
  gLogFile.write(data);
  var consoleSvc = CC["@mozilla.org/consoleservice;1"]
                .getService(CI.nsIConsoleService);
  consoleSvc.logStringMessage(data);
  dump(data);
}

var gRecycledCanvases = new Array();

function AllocateCanvas()
{
    var windowElem = document.documentElement;

    if (gRecycledCanvases.length > 0)
        return gRecycledCanvases.shift();

    var canvas = document.createElementNS(XHTML_NS, "canvas");
    canvas.setAttribute("width", windowElem.getAttribute("width"));
    canvas.setAttribute("height", windowElem.getAttribute("height"));
    return canvas;
}

function ReleaseCanvas(canvas)
{
    gRecycledCanvases.push(canvas);
}

function OnRefTestLoad()
{
    gBrowser = document.getElementById("browser");
    /* set the gLoadTimeout */
    try {
      var prefs = CC["@mozilla.org/preferences-service;1"].
                  getService(CI.nsIPrefBranch2);
      gLoadTimeout = prefs.getIntPref("reftest.timeout");
    }                  
    catch(e) {
      gLoadTimeout = 5 * 60 * 1000; //5 minutes as per bug 479518
    }

    gBrowser.addEventListener("load", OnDocumentLoad, true);

    try {
        gWindowUtils = window.QueryInterface(CI.nsIInterfaceRequestor).getInterface(CI.nsIDOMWindowUtils);
        if (gWindowUtils && !gWindowUtils.compareCanvases)
            gWindowUtils = null;
    } catch (e) {
        gWindowUtils = null;
    }

    var windowElem = document.documentElement;

    gIOService = CC[IO_SERVICE_CONTRACTID].getService(CI.nsIIOService);
    gDebug = CC[DEBUG_CONTRACTID].getService(CI.nsIDebug2);

    StartTests();
}

function StartFirstTest() {
  try {
      if (gManifestCount == gManifestsRead) {
        // If all of the included manifests have been read, start the tests...
        gTotalTests = gURLs.length;

        if (!gTotalTests)
            throw "No tests to run";
            
        var testsToSkip = gTestResults.ThisChunkStartTest;
        while (testsToSkip > 0) {
          gURLs.shift();
          testsToSkip--;
        }

        gURICanvases = {};
        BuildUseCounts();
        StartCurrentTest();        
      }
      else {
        // ...otherwise wait a little and try again.
        setTimeout(StartFirstTest, 100);
      }
  } catch (ex) {
      dumpEx("REFTEST TEST-UNEXPECTED-FAIL | | EXCEPTION: " + ex + "\n");
      ++gTestResults.Exception;
      DoneTests();
  }
}

function StartTests()
{
    try {
        // The gTestResults object is populated by parsing a JSON
        // string that appears as an attribute of an element on the
        // reftest HTML page.
        var bdoc = gParentBrowser.contentDocument;
        var elm = bdoc.getElementById("listen");
        var attr = elm.getAttribute("data");
        gTestResults = JSON.parse(attr);
      
        ReadTopManifest(gTestResults.ManifestURL);
        setTimeout(StartFirstTest, 0);
    } catch (ex) {
        dumpEx("REFTEST TEST-UNEXPECTED-FAIL | | EXCEPTION: " + ex + "\n");
        ++gTestResults.Exception;
        DoneTests();
    }
}

function OnRefTestUnload()
{
    /* Clear the sRGB forcing pref to leave the profile as we found it. */
    var prefs = Components.classes["@mozilla.org/preferences-service;1"].
                getService(Components.interfaces.nsIPrefBranch2);
    prefs.clearUserPref("gfx.color_management.force_srgb");

    gBrowser.removeEventListener("load", OnDocumentLoad, true);
}

function ReadTopManifest(aManifestURL)
{
    gURLs = new Array();
    var url = gIOService.newURI(aManifestURL, null, null);
    if (!url || url.scheme != "http")
        throw "Invalid URL for the manifest.";

    // Initialize our logging; create the log file in the
    // directory that the extension is located in.
    var em = CC["@mozilla.org/extensions/manager;1"].
             getService(CI.nsIExtensionManager);
    var installRdfFile = em.getInstallLocation(EXTENSION_ID)
                           .getItemFile(EXTENSION_ID, "install.rdf");
    gLogFile.init(installRdfFile.parent.path);
    ReadManifest(url);
}

// Read all available data from an input stream and return it
// as a string.
function GetStreamContent(inputStream)
{
  var streamBuf = "";
  var factory = CC["@mozilla.org/scriptableinputstream;1"];
  var sis = factory.createInstance(CI.nsIScriptableInputStream);
  sis.init(inputStream);

  try
  {
    while (true)
    {
      var chunk = sis.read(512);
      if (chunk.length == 0)
        break;

      streamBuf += chunk;
    }
  }
  catch (e)
  {
    dumpEx("REFTEST TEST-UNEXPECTED-FAIL | | : failed reading from stream:" +
      e + "\n");
    DoneTests();
  }
  
  return streamBuf;
}

// Note: If you materially change the reftest manifest parsing,
// please keep the parser in print-manifest-dirs.py in sync.
function ReadManifest(manifestURL)
{
    var secMan = CC[NS_SCRIPTSECURITYMANAGER_CONTRACTID]
                     .getService(CI.nsIScriptSecurityManager);

    // Load the manifest url via HTTP.
    var channel = gIOService.newChannelFromURI(manifestURL);
    var inputStream = channel.open();
    if (channel instanceof Components.interfaces.nsIHttpChannel 
      && channel.responseStatus != 200) { 
      dumpEx("REFTEST TEST-UNEXPECTED-FAIL | | HTTP ERROR : " + 
        channel.responseStatus + "\n");
    }
    var streamBuf = GetStreamContent(inputStream);
    inputStream.close();
    
    var lines = streamBuf.split("\n");

    // Build the sandbox for fails-if(), etc., condition evaluation.
    var sandbox = new Components.utils.Sandbox(manifestURL.spec);
    var xr = CC[NS_XREAPPINFO_CONTRACTID].getService(CI.nsIXULRuntime);
    sandbox.MOZ_WIDGET_TOOLKIT = xr.widgetToolkit;
    sandbox.xulRuntime = {widgetToolkit: xr.widgettoolkit, OS: xr.OS};

    // xr.XPCOMABI throws exception for configurations without full ABI support (mobile builds on ARM)
    try {
      sandbox.XPCOMABI = xr.XPCOMABI;
    } catch(e) {}

    var hh = CC[NS_NETWORK_PROTOCOL_CONTRACTID_PREFIX + "http"].
                 getService(CI.nsIHttpProtocolHandler);
    sandbox.http = {};
    for each (var prop in [ "userAgent", "appName", "appVersion",
                            "vendor", "vendorSub", "vendorComment",
                            "product", "productSub", "productComment",
                            "platform", "oscpu", "language", "misc" ])
        sandbox.http[prop] = hh[prop];
    // see if we have the test plugin available,
    // and set a sandox prop accordingly
    sandbox.haveTestPlugin = false;
    for (var i = 0; i < navigator.mimeTypes.length; i++) {
        if (navigator.mimeTypes[i].type == "application/x-test" &&
            navigator.mimeTypes[i].enabledPlugin != null &&
            navigator.mimeTypes[i].enabledPlugin.name == "Test Plug-in") {
            sandbox.haveTestPlugin = true;
            break;
        }
    }

    var line = {value:null};
    var lineNo = 0;
    for each (var line in lines) {
        ++lineNo;
        var str = line;
        if (str.charAt(0) == "#")
            continue; // entire line was a comment
        var i = str.search(/\s+#/);
        if (i >= 0)
            str = str.substring(0, i);
        // strip leading and trailing whitespace
        str = str.replace(/^\s*/, '').replace(/\s*$/, '');
        if (!str || str == "")
            continue;
        var items = str.split(/\s+/); // split on whitespace

        var expected_status = EXPECTED_PASS;
        var minAsserts = 0;
        var maxAsserts = 0;
        while (items[0].match(/^(fails|random|skip|asserts)/)) {
            var item = items.shift();
            var stat;
            var cond;
            var m = item.match(/^(fails|random|skip)-if(\(.*\))$/);
            if (m) {
                stat = m[1];
                // Note: m[2] contains the parentheses, and we want them.
                cond = Components.utils.evalInSandbox(m[2], sandbox);
            } else if (item.match(/^(fails|random|skip)$/)) {
                stat = item;
                cond = true;
            } else if ((m = item.match(/^asserts\((\d+)(-\d+)?\)$/))) {
                cond = false;
                minAsserts = Number(m[1]);
                maxAsserts = (m[2] == undefined) ? minAsserts
                                                 : Number(m[2].substring(1));
            } else if ((m = item.match(/^asserts-if\((.*?),(\d+)(-\d+)?\)$/))) {
                cond = false;
                if (Components.utils.evalInSandbox("(" + m[1] + ")", sandbox)) {
                    minAsserts = Number(m[2]);
                    maxAsserts =
                      (m[3] == undefined) ? minAsserts
                                          : Number(m[3].substring(1));
                }
            } else {
                throw "Error in manifest file " + manifestURL.spec + " line " + lineNo;
            }

            if (cond) {
                if (stat == "fails") {
                    expected_status = EXPECTED_FAIL;
                } else if (stat == "random") {
                    expected_status = EXPECTED_RANDOM;
                } else if (stat == "skip") {
                    expected_status = EXPECTED_DEATH;
                }
            }
        }

        if (minAsserts > maxAsserts) {
            throw "Bad range in manifest file " + manifestURL.spec + " line " + lineNo;
        }

        var runHttp = false;
        var httpDepth;
        if (items[0] == "HTTP") {
            runHttp = true;
            httpDepth = 0;
            items.shift();
        } else if (items[0].match(/HTTP\(\.\.(\/\.\.)*\)/)) {
            // Accept HTTP(..), HTTP(../..), HTTP(../../..), etc.
            runHttp = true;
            httpDepth = ((items[0].length - 5) / 3) - 1;
            items.shift();
        }

        if (items[0] == "include") {
            // For 'include' lines, increment the total manifest count, 
            // then schedule the manifest to be read.  This is done
            // asynchronously in order to avoid "slow script" warnings.
            if (items.length != 2 || runHttp)
                throw "Error in manifest file " + manifestURL.spec + " line " + lineNo;
            var incURI = gIOService.newURI(items[1], null, manifestURL);
            secMan.checkLoadURI(manifestURL, incURI,
                                CI.nsIScriptSecurityManager.DISALLOW_SCRIPT);
            gManifestCount++;
            function doReadManifest(uri) {
              setTimeout(function() { ReadManifest(uri); }, 0);
            }
            doReadManifest(incURI);
        } else if (items[0] == "load") {
            if (expected_status == EXPECTED_PASS)
                expected_status = EXPECTED_LOAD;
            if (items.length != 2 ||
                (expected_status != EXPECTED_LOAD &&
                 expected_status != EXPECTED_DEATH))
                throw "Error in manifest file " + manifestURL.spec + " line " + lineNo;
            var parent = runHttp ? GetUrlBase(manifestURL, httpDepth) : manifestURL;
            var [testURI] = [gIOService.newURI(items[1], null, parent)];
            var prettyPath = testURI.spec;
            secMan.checkLoadURI(manifestURL, testURI,
                                CI.nsIScriptSecurityManager.DISALLOW_SCRIPT);
            gURLs.push( { equal: true /* meaningless */,
                          expected: expected_status,
                          prettyPath: prettyPath,
                          minAsserts: minAsserts,
                          maxAsserts: maxAsserts,
                          url1: testURI,
                          url2: null } );
        } else if (items[0] == "==" || items[0] == "!=") {
            if (items.length != 3)
                throw "Error in manifest file " + manifestURL.spec + " line " + lineNo;
            var parent = runHttp ? GetUrlBase(manifestURL, httpDepth) : manifestURL;
            var [testURI, refURI] = 
              [gIOService.newURI(items[1], null, parent),
               gIOService.newURI(items[2], null, parent)];
            var prettyPath = testURI.spec;
            secMan.checkLoadURI(manifestURL, testURI,
                                CI.nsIScriptSecurityManager.DISALLOW_SCRIPT);
            secMan.checkLoadURI(manifestURL, refURI,
                                CI.nsIScriptSecurityManager.DISALLOW_SCRIPT);
            gURLs.push( { equal: (items[0] == "=="),
                          expected: expected_status,
                          prettyPath: prettyPath,
                          minAsserts: minAsserts,
                          maxAsserts: maxAsserts,
                          url1: testURI,
                          url2: refURI } );
        } else {
            throw "Error in manifest file " + manifestURL.spec + " line " + lineNo;
        }
    }
    gManifestsRead++;
}

function AddURIUseCount(uri)
{
    if (uri == null)
        return;

    var spec = uri.spec;
    if (spec in gURIUseCounts) {
        gURIUseCounts[spec]++;
    } else {
        gURIUseCounts[spec] = 1;
    }
}

function BuildUseCounts()
{
    gURIUseCounts = {};
    for (var i = 0; i < gURLs.length; ++i) {
        var expected = gURLs[i].expected;
        if (expected != EXPECTED_DEATH && expected != EXPECTED_LOAD) {
            AddURIUseCount(gURLs[i].url1);
            AddURIUseCount(gURLs[i].url2);
        }
    }
}

// Given an http nsIURI, return the parent nsIURI, after
// popping 'depth' directories off the end.
function GetUrlBase(fileurl, depth) {
  var path = fileurl.spec;
  // strip the filename from the path
  path = path.substring(0, path.lastIndexOf("/"));
  // strip path directories up to depth count
  while (depth > 0) {
    var slash = path.lastIndexOf("/");
    if (slash < 8) {
      throw "Url with less than 'depth' directories passed to GetUrlBase";
    }
    path = path.substring(0, slash);
    --depth;
  }
  
  return gIOService.newURI(path + "/", null, null);
}


function StartCurrentTest()
{
    // make sure we don't run tests that are expected to kill the browser
    while (gURLs.length > 0 && gURLs[0].expected == EXPECTED_DEATH) {
        ++gTestResults.Skip;
        dumpEx("REFTEST TEST-KNOWN-FAIL | " + gURLs[0].url1.spec + " | (SKIP)\n");
        gURLs.shift();
    }

    var currentTest = gTotalTests - gURLs.length;
    dumpEx("Starting Test " + currentTest + " of " + gTotalTests + "\n");
    if (gURLs.length == 0) {
        // we're done testing
        dumpEx("DEBUG finished URL list closing tests\n");
        DoneTests();
    }
    else if ((currentTest - gTestResults.ThisChunkStartTest) >=
        gTestResults.ChunkSize) {
        // we're done testing the current chunk, so send the test
        // results to the reftest HTML page, and close the reftest window
        gTestResults.ThisChunkStartTest = currentTest;
        gTestResults.TestsContinue = true;
        SendTestResults();
        gBrowser.contentWindow.close();
    }
    else {
        document.title = "reftest: " + currentTest + " / " + gTotalTests +
            " (" + Math.floor(100 * (currentTest / gTotalTests)) + "%)";
        StartCurrentURI(1);
    }
}

function StartCurrentURI(aState)
{
    dumpEx("Start Current URI in state: " + aState + "\n");
    gCurrentTestStartTime = Date.now();
    if (gFailureTimeout != null) {
        dumpEx("REFTEST TEST-UNEXPECTED-FAIL | " +
             "| program error managing timeouts\n");
        ++gTestResults.Exception;
    }
    gFailureTimeout = setTimeout(LoadFailed, gLoadTimeout);
    gFailureReason = "timed out waiting for onload to fire";

    gState = aState;
    gCurrentURL = gURLs[0]["url" + aState].spec;

    if (gURICanvases[gCurrentURL] && gURLs[0].expected != EXPECTED_LOAD &&
        gURLs[0].maxAsserts == 0) {
        // Pretend the document loaded --- DocumentLoaded will notice
        // there's already a canvas for this URL
        setTimeout(DocumentLoaded, 0);
    } else {
        gBrowser.loadURI(gCurrentURL);
    }
}

function DoneTests()
{ 
    dumpEx("REFTEST FINISHED: Slowest test took " + gSlowestTestTime +
         "ms (" + gSlowestTestURL + ")\n");

    dumpEx("REFTEST INFO | Result summary:\n");
    var count = gTestResults.Pass + gTestResults.LoadOnly;
    dumpEx("REFTEST INFO | Successful: " + count + " (" +
         gTestResults.Pass + " pass, " +
         gTestResults.LoadOnly + " load only)\n");
    count = gTestResults.Exception + gTestResults.FailedLoad +
            gTestResults.UnexpectedFail + gTestResults.UnexpectedPass +
            gTestResults.AssertionUnexpected +
            gTestResults.AssertionUnexpectedFixed;
    dumpEx("REFTEST INFO | Unexpected: " + count + " (" +
         gTestResults.UnexpectedFail + " unexpected fail, " +
         gTestResults.UnexpectedPass + " unexpected pass, " +
         gTestResults.AssertionUnexpected + " unexpected asserts, " +
         gTestResults.AssertionUnexpectedFixed + " unexpected fixed asserts, " +
         gTestResults.FailedLoad + " failed load, " +
         gTestResults.Exception + " exception)\n");
    count = gTestResults.KnownFail + gTestResults.AssertionKnown +
            gTestResults.Random + gTestResults.Skip;
    dumpEx("REFTEST INFO | Known problems: " + count + " (" +
         gTestResults.KnownFail + " known fail, " +
         gTestResults.AssertionKnown + " known asserts, " +
         gTestResults.Random + " random, " +
         gTestResults.Skip + " skipped)\n");

    dumpEx("REFTEST INFO | Total canvas count = " + gRecycledCanvases.length + "\n");

    function onStopped() {
        dumpEx("REFTEST INFO | Quitting...\n");
        gTestResults.TestsComplete = true;
        SendTestResults();
        gBrowser.contentWindow.close();
        //goQuitApplication();
    }
    
    onStopped();
}

function setupZoom(contentRootElement) {
    if (!contentRootElement ||
        !contentRootElement.hasAttribute('reftest-zoom'))
        return;
    gBrowser.markupDocumentViewer.fullZoom =
        contentRootElement.getAttribute('reftest-zoom');
}

function resetZoom() {
    gBrowser.markupDocumentViewer.fullZoom = 1.0;
}

function OnDocumentLoad(event)
{
    dumpEx("DEBUG OnDocumentLoad is called\n");
    if (event.target != gBrowser.contentDocument)
        // Ignore load events for subframes.
        return;

    if (gClearingForAssertionCheck &&
        gBrowser.contentDocument.location.href == BLANK_URL_FOR_CLEARING) {
        DoAssertionCheck();
        return;
    }

    if (gBrowser.contentDocument.location.href != gCurrentURL)
        // Ignore load events for previous documents.
        return;

    // This can be undefined, e.g., in reftest-sanity/no-root.html
    var contentRootElement = gBrowser.contentDocument.documentElement;

    function shouldWait() {
        if (!contentRootElement)
            return false;
        // use getAttribute because className works differently in HTML and SVG
        return contentRootElement.hasAttribute('class') &&
               contentRootElement.getAttribute('class').split(/\s+/)
                                 .indexOf("reftest-wait") != -1;
    }

    function doPrintMode() {
        if (!contentRootElement)
            return false;
        // use getAttribute because className works differently in HTML and SVG
        return contentRootElement.hasAttribute('class') &&
               contentRootElement.getAttribute('class').split(/\s+/)
                                 .indexOf("reftest-print") != -1;
    }

    function setupPrintMode() {
       var PSSVC = Components.classes["@mozilla.org/gfx/printsettings-service;1"]
                  .getService(Components.interfaces.nsIPrintSettingsService);
       var ps = PSSVC.newPrintSettings;
       ps.paperWidth = 5;
       ps.paperHeight = 3;

       // Override any os-specific unwriteable margins
       ps.unwriteableMarginTop = 0;
       ps.unwriteableMarginLeft = 0;
       ps.unwriteableMarginBottom = 0;
       ps.unwriteableMarginRight = 0;

       ps.headerStrLeft = "";
       ps.headerStrCenter = "";
       ps.headerStrRight = "";
       ps.footerStrLeft = "";
       ps.footerStrCenter = "";
       ps.footerStrRight = "";
       gBrowser.docShell.contentViewer.setPageMode(true, ps);
    }

    setupZoom(contentRootElement);

    if (shouldWait()) {
        // The testcase will let us know when the test snapshot should be made.
        // Register a mutation listener to know when the 'reftest-wait' class
        // gets removed.
        gFailureReason = "timed out waiting for reftest-wait to be removed (after onload fired)"

        var stopAfterPaintReceived = false;
        var currentDoc = gBrowser.contentDocument;
        var utils = gBrowser.contentWindow.QueryInterface(CI.nsIInterfaceRequestor)
            .getInterface(CI.nsIDOMWindowUtils);

        function FlushRendering() {
            // Flush pending restyles and reflows
            contentRootElement.getBoundingClientRect();
            // Flush out invalidation
            utils.processUpdates();
        }

        function WhenMozAfterPaintFlushed(continuation) {
            if (utils.isMozAfterPaintPending) {
                function handler() {
                    gBrowser.removeEventListener("MozAfterPaint", handler, false);
                    continuation();
                }
                gBrowser.addEventListener("MozAfterPaint", handler, false);
            } else {
                continuation();
            }
        }

        function AfterPaintListener(event) {
            if (event.target.document != currentDoc) {
                // ignore paint events for subframes or old documents in the window.
                // Invalidation in subframes will cause invalidation in the main document anyway.
                return;
            }

            FlushRendering();
            UpdateCurrentCanvasForEvent(event);
            // When stopAfteraintReceived is set, we can stop --- but we should keep going as long
            // as there are paint events coming (there probably shouldn't be any, but it doesn't
            // hurt to process them)
            if (stopAfterPaintReceived && !utils.isMozAfterPaintPending) {
                FinishWaitingForTestEnd();
            }
        }

        function FinishWaitingForTestEnd() {
            gBrowser.removeEventListener("MozAfterPaint", AfterPaintListener, false);
            setTimeout(DocumentLoaded, 0);
        }

        function AttrModifiedListener() {
            if (shouldWait())
                return;

            // We don't want to be notified again
            contentRootElement.removeEventListener("DOMAttrModified", AttrModifiedListener, false);
            // Wait for the next return-to-event-loop before continuing to flush rendering and
            // check isMozAfterPaintPending --- for example, the attribute may have been modified
            // in an subdocument's load event handler, in which case we need load event processing
            // to complete and unsuppress painting before we check isMozAfterPaintPending.
            setTimeout(AttrModifiedListenerContinuation, 0);
        }

        function AttrModifiedListenerContinuation() {
            if (doPrintMode())
                setupPrintMode();
            FlushRendering();

            if (utils.isMozAfterPaintPending) {
                // Wait for the last invalidation to have happened and been snapshotted before
                // we stop the test
                stopAfterPaintReceived = true;
            } else {
                // Nothing to wait for, so stop now
                FinishWaitingForTestEnd();
            }
        }

        function StartWaitingForTestEnd() {
            FlushRendering();

            function continuation() {
                gBrowser.addEventListener("MozAfterPaint", AfterPaintListener, false);
                contentRootElement.addEventListener("DOMAttrModified", AttrModifiedListener, false);

                // Take a snapshot of the window in its current state
                InitCurrentCanvasWithSnapshot();

                if (!shouldWait()) {
                    // reftest-wait was already removed (during the interval between OnDocumentLoaded
                    // calling setTimeout(StartWaitingForTestEnd,0) below, and this function
                    // actually running), so let's fake a direct notification of the attribute
                    // change.
                    AttrModifiedListener();
                    return;
                }

                // Notify the test document that now is a good time to test some invalidation
                var notification = document.createEvent("Events");
                notification.initEvent("MozReftestInvalidate", true, false);
                contentRootElement.dispatchEvent(notification);
            }
            WhenMozAfterPaintFlushed(continuation);
        }

        // After this load event has finished being dispatched, painting is normally
        // unsuppressed, which invalidates the entire window. So ensure
        // StartWaitingForTestEnd runs after that invalidation has been requested.
        setTimeout(StartWaitingForTestEnd, 0);
    } else {
        if (doPrintMode())
            setupPrintMode();

        // Since we can't use a bubbling-phase load listener from chrome,
        // this is a capturing phase listener.  So do setTimeout twice, the
        // first to get us after the onload has fired in the content, and
        // the second to get us after any setTimeout(foo, 0) in the content.
        setTimeout(setTimeout, 0, DocumentLoaded, 0);
    }
}

function UpdateCanvasCache(url, canvas)
{
    var spec = url.spec;

    --gURIUseCounts[spec];
    if (gURIUseCounts[spec] == 0) {
        ReleaseCanvas(canvas);
        delete gURICanvases[spec];
    } else if (gURIUseCounts[spec] > 0) {
        gURICanvases[spec] = canvas;
    } else {
        throw "Use counts were computed incorrectly";
    }
}

function InitCurrentCanvasWithSnapshot()
{
    gCurrentCanvas = AllocateCanvas();

    /* XXX This needs to be rgb(255,255,255) because otherwise we get
     * black bars at the bottom of every test that are different size
     * for the first test and the rest (scrollbar-related??) */
    var win = gBrowser.contentWindow;
    var ctx = gCurrentCanvas.getContext("2d");
    var scale = gBrowser.markupDocumentViewer.fullZoom;
    ctx.save();
    // drawWindow always draws one canvas pixel for each CSS pixel in the source
    // window, so scale the drawing to show the zoom (making each canvas pixel be one
    // device pixel instead)
    ctx.scale(scale, scale);
    ctx.drawWindow(win, win.scrollX, win.scrollY,
                   Math.ceil(gCurrentCanvas.width / scale),
                   Math.ceil(gCurrentCanvas.height / scale),
                   "rgb(255,255,255)");
    ctx.restore();
}

function roundTo(x, fraction)
{
    return Math.round(x/fraction)*fraction;
}

function UpdateCurrentCanvasForEvent(event)
{
    var win = gBrowser.contentWindow;
    var ctx = gCurrentCanvas.getContext("2d");
    var scale = gBrowser.markupDocumentViewer.fullZoom;

    var rectList = event.clientRects;
    for (var i = 0; i < rectList.length; ++i) {
        var r = rectList[i];
        // Set left/top/right/bottom to "device pixel" boundaries
        var left = Math.floor(roundTo(r.left*scale, 0.001))/scale;
        var top = Math.floor(roundTo(r.top*scale, 0.001))/scale;
        var right = Math.ceil(roundTo(r.right*scale, 0.001))/scale;
        var bottom = Math.ceil(roundTo(r.bottom*scale, 0.001))/scale;

        ctx.save();
        ctx.scale(scale, scale);
        ctx.translate(left, top);
        ctx.drawWindow(win, left + win.scrollX, top + win.scrollY,
                       right - left, bottom - top,
                       "rgb(255,255,255)");
        ctx.restore();
    }
}

function DocumentLoaded()
{
    dumpEx("Document Loaded with URL: " + gCurrentURL + "\n");
    // Keep track of which test was slowest, and how long it took.
    var currentTestRunTime = Date.now() - gCurrentTestStartTime;
    if (currentTestRunTime > gSlowestTestTime) {
        gSlowestTestTime = currentTestRunTime;
        gSlowestTestURL  = gCurrentURL;
    }

    clearTimeout(gFailureTimeout);
    gFailureReason = null;
    gFailureTimeout = null;

    if (gURLs[0].expected == EXPECTED_LOAD) {
        ++gTestResults.LoadOnly;
        dumpEx("REFTEST TEST-PASS | " + gURLs[0].prettyPath + " | (LOAD ONLY)\n");
        FinishTestItem();
        return;
    }

    if (gURICanvases[gCurrentURL]) {
        gCurrentCanvas = gURICanvases[gCurrentURL];
    } else if (gCurrentCanvas == null) {
        InitCurrentCanvasWithSnapshot();
    }
    if (gState == 1) {
        gCanvas1 = gCurrentCanvas;
    } else {
        gCanvas2 = gCurrentCanvas;
    }
    gCurrentCanvas = null;

    resetZoom();

    switch (gState) {
        case 1:
            // First document has been loaded.
            // Proceed to load the second document.

            StartCurrentURI(2);
            break;
        case 2:
            // Both documents have been loaded. Compare the renderings and see
            // if the comparison result matches the expected result specified
            // in the manifest.

            // number of different pixels
            var differences;
            // whether the two renderings match:
            var equal;

            if (gWindowUtils) {
                differences = gWindowUtils.compareCanvases(gCanvas1, gCanvas2, {});
                equal = (differences == 0);
            } else {
                differences = -1;
                var k1 = gCanvas1.toDataURL();
                var k2 = gCanvas2.toDataURL();
                equal = (k1 == k2);
            }

            // whether the comparison result matches what is in the manifest
            var test_passed = (equal == gURLs[0].equal);
            // what is expected on this platform (PASS, FAIL, or RANDOM)
            var expected = gURLs[0].expected;

            // Not 'const ...' because of 'EXPECTED_*' value dependency.
            var outputs = {};
            const randomMsg = "(EXPECTED RANDOM)";
            outputs[EXPECTED_PASS] = {
              true:  {s: "TEST-PASS"                  , n: "Pass"},
              false: {s: "TEST-UNEXPECTED-FAIL"       , n: "UnexpectedFail"}
            };
            outputs[EXPECTED_FAIL] = {
              true:  {s: "TEST-UNEXPECTED-PASS"       , n: "UnexpectedPass"},
              false: {s: "TEST-KNOWN-FAIL"            , n: "KnownFail"}
            };
            outputs[EXPECTED_RANDOM] = {
              true:  {s: "TEST-PASS" + randomMsg      , n: "Random"},
              false: {s: "TEST-KNOWN-FAIL" + randomMsg, n: "Random"}
            };

            ++gTestResults[outputs[expected][test_passed].n];

            var result = "REFTEST " + outputs[expected][test_passed].s + " | " +
                         gURLs[0].prettyPath + " | "; // the URL being tested
            if (!gURLs[0].equal) {
                result += "(!=) ";
            }
            dumpEx(result + "\n");

            if (!test_passed && expected == EXPECTED_PASS ||
                test_passed && expected == EXPECTED_FAIL) {
                if (!equal) {
                    dumpEx("REFTEST   IMAGE 1 (TEST): " + gCanvas1.toDataURL() + "\n");
                    dumpEx("REFTEST   IMAGE 2 (REFERENCE): " + gCanvas2.toDataURL() + "\n");
                    dumpEx("REFTEST number of differing pixels: " + differences + "\n");
                } else {
                    dumpEx("REFTEST   IMAGE: " + gCanvas1.toDataURL() + "\n");
                }
            }

            UpdateCanvasCache(gURLs[0].url1, gCanvas1);
            UpdateCanvasCache(gURLs[0].url2, gCanvas2);

            FinishTestItem();
            break;
        default:
            throw "Unexpected state.";
    }
}

function LoadFailed()
{
    gFailureTimeout = null;
    ++gTestResults.FailedLoad;
    dumpEx("REFTEST TEST-UNEXPECTED-FAIL | " +
         gURLs[0]["url" + gState].spec + " | " + gFailureReason + "\n");
    FinishTestItem();
}

function FinishTestItem()
{
    // Replace document with BLANK_URL_FOR_CLEARING in case there are
    // assertions when unloading.
    gClearingForAssertionCheck = true;
    gBrowser.loadURI(BLANK_URL_FOR_CLEARING);
}

function DoAssertionCheck()
{
    gClearingForAssertionCheck = false;

    if (gDebug.isDebugBuild) {
        // TEMPORARILY DISABLING ASSERTION CHECKS FOR NOW.  TO RE-ENABLE,
        // USE COMMENTED LINE TO REPLACE FOLLOWING ONE.
        // var newAssertionCount = gDebug.assertionCount;
        var newAssertionCount = 0;
        var numAsserts = newAssertionCount - gAssertionCount;
        gAssertionCount = newAssertionCount;

        var minAsserts = gURLs[0].minAsserts;
        var maxAsserts = gURLs[0].maxAsserts;

        var expectedAssertions = "expected " + minAsserts;
        if (minAsserts != maxAsserts) {
            expectedAssertions += " to " + maxAsserts;
        }
        expectedAssertions += " assertions";

        if (numAsserts < minAsserts) {
            ++gTestResults.AssertionUnexpectedFixed;
            dumpEx("REFTEST TEST-UNEXPECTED-PASS | " + gURLs[0].prettyPath +
                 " | assertion count " + numAsserts + " is less than " +
                 expectedAssertions + "\n");
        } else if (numAsserts > maxAsserts) {
            ++gTestResults.AssertionUnexpected;
            dumpEx("REFTEST TEST-UNEXPECTED-FAIL | " + gURLs[0].prettyPath +
                 " | assertion count " + numAsserts + " is more than " +
                 expectedAssertions + "\n");
        } else if (numAsserts != 0) {
            ++gTestResults.AssertionKnown;
            dumpEx("REFTEST TEST-KNOWN-FAIL | " + gURLs[0].prettyPath +
                 " | assertion count " + numAsserts + " matches " +
                 expectedAssertions + "\n");
        }
    }

    // And start the next test.
    gURLs.shift();
    StartCurrentTest();
}
