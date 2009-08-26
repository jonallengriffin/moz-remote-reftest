const CC = Components.classes;
const CI = Components.interfaces;

// Default values for gTestResults
var gDefaults = {
  // Successful...
  Pass: 0,
  LoadOnly: 0,
  // Unexpected...
  Exception: 0,
  FailedLoad: 0,
  UnexpectedFail: 0,
  UnexpectedPass: 0,
  AssertionUnexpected: 0,
  AssertionUnexpectedFixed: 0,
  // Known problems...
  KnownFail : 0,
  AssertionKnown: 0,
  Random : 0,
  Skip: 0,
  // Test control...
  ThisChunkStartTest: 0,
  TestsComplete: false,
  TestsContinue: false,
  ManifestURL: "",
  ChunkSize: 50,
};
// Current test results
var gTestResults = {};
// Tracks whether a test is currently being run
var gIsTesting;

function copyObject(source, dest) {
  for (var prop in source) {
    dest[prop] = source[prop];
  }
}

/**
 * This funciton handles the "dataevent" notifications from extension
 * chrome code.  When this message is received, parse the "data" attribute
 * of the target element to update the local copy of gTestResults.  If
 * the tests are marked as complete, reset the gTestResults object to its
 * initial state, so that it's ready for another reftest to be executed.
 */
function dataEventListener(event) {
  var elm = event.target;
  var data = elm.getAttribute("data");
  gTestResults = JSON.parse(data);
  if (gTestResults.TestsComplete) {
    for (var prop in gTestResults) {
      if (prop != "TestsComplete" && prop != "TestsContinue")
        gTestResults[prop] = 0;
    }
  }
}
window.addEventListener("dataevent",dataEventListener,false);

var remoteReftestTestDriver = {
  NextTestChunk: function gtd_nextTestChunk() {
    if (gTestResults.TestsComplete || !gTestResults.TestsContinue) {
      gIsTesting = false;
      var wwatch = CC["@mozilla.org/embedcomp/window-watcher;1"]
                   .getService(Components.interfaces.nsIWindowWatcher);
      wwatch.unregisterNotification(remoteReftestTestDriver.WindowObserver); 
      if (!gTestResults.TestsContinue) {
        var ldata = document.createElement("p");
        ldata.innerHTML = "REFTEST INFO | User aborted tests";
        document.getElementById("results").appendChild(ldata);
      }     
    }
    else {
      gTestResults.TestsContinue = false;
      var prefs = CC["@mozilla.org/preferences-service;1"]
                  .getService(Components.interfaces.nsIPrefBranch2);
      prefs.setBoolPref("gfx.color_management.force_srgb", true);
      var wwatch = CC["@mozilla.org/embedcomp/window-watcher;1"]
                   .getService(Components.interfaces.nsIWindowWatcher);
      var args = CC["@mozilla.org/supports-string;1"]
                 .createInstance(CI.nsISupportsString);
      wwatch.openWindow(null,
         "chrome://remote-reftest/content/reftest.xul",
        "_blank", "chrome,dialog=no,all", args);      
    }
  },
  WindowObserver: {
    observe: function gtd_windowObserver(aSubject, aTopic, aData) {
      if (aSubject.location == "chrome://remote-reftest/content/reftest.xul" 
          && aTopic == "domwindowclosed")
        {
          setTimeout(remoteReftestTestDriver.NextTestChunk, 0);
        }
    }
  },
  runReftest: function gtd_reftst(manifest, startTest, chunkSize) {
    // Most of this code is copied from the command line handler code.
    try {
      // Create a URI from the manifest file
      var cmdline = CC["@mozilla.org/toolkit/command-line;1"]
                    .createInstance(Components.interfaces.nsICommandLine);
      var args = CC["@mozilla.org/supports-string;1"]
                 .createInstance(CI.nsISupportsString);

      // Add the url to the gTestResults object
      copyObject(gDefaults, gTestResults);
      gTestResults.ManifestURL = cmdline.resolveURI(manifest).spec;
      gTestResults.TestsComplete = false;
      gTestResults.ThisChunkStartTest = startTest;
      gTestResults.ChunkSize = chunkSize;
      var elm = document.getElementById("listen");
      elm.setAttribute("data", JSON.stringify(gTestResults));

      /* Ignore the platform's online/offline status while running 
         reftests. */
      var ios2 = CC["@mozilla.org/network/io-service;1"]
                .getService(Components.interfaces.nsIIOService2);
      ios2.manageOfflineStatus = false;
      ios2.offline = false;

      /* Force sRGB as an output profile for color management before we load a
         window. */
      var prefs = CC["@mozilla.org/preferences-service;1"]
                  .getService(Components.interfaces.nsIPrefBranch2);
      prefs.setBoolPref("gfx.color_management.force_srgb", true);

      var wwatch = CC["@mozilla.org/embedcomp/window-watcher;1"]
                   .getService(Components.interfaces.nsIWindowWatcher);
      wwatch.registerNotification(remoteReftestTestDriver.WindowObserver);
      wwatch.openWindow(null,
         "chrome://remote-reftest/content/reftest.xul",
        "_blank", "chrome,dialog=no,all", args);
    }
    catch (e) {
      // display the exception to the user
      document.getElementById("results").innerHTML = "<p>" + e + "</p>";
      return;
    }

  },
  submitForm: function gtd_submit() {
    // Prevent a new from starting while one is already running.
    if (gIsTesting)
      return;
    gIsTesting = true;
    
    // If the warning is displayed, hide it.
    var shownwarning = document.getElementById("show");
    if (shownwarning) {
      shownwarning.setAttribute("id", "dontshow");
    }

    var inputctrl = document.getElementById("file-input");
    
    if (inputctrl.value.indexOf('reftest.list') ||
        inputctrl.value.indexOf('reftests.list') ||
        inputctrl.value.indexOf('crashtest.list') ||
        inputctrl.value.indexOf('crashtests.list') ) {

      var results = document.getElementById("results");
      results.innerHTML = "<p>REFTEST INFO | Starting tests</p>";
      
      var startTest = parseInt(document.getElementById("startnumber").value,
        10);
      var chunkSize = parseInt(document.getElementById("chunks").value, 10);
      if (chunkSize < 1) 
        chunkSize = 9999;

      this.runReftest(inputctrl.value, startTest, chunkSize);
    } else {
      var warning = document.getElementById("dontshow");
      warning.setAttribute("id", "show");
    }
  }
}