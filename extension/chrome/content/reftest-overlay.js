function onRemoteReftestMenuCommand(event) {
  var newtab;
  if (gBrowser) {
    newtab = gBrowser.addTab("chrome://remote-reftest/content/start-testing.html");
    gBrowser.selectedTab = newtab;
  } else {
    var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                       .getService(Components.interfaces.nsIWindowMediator);
    var mainWindow = wm.getMostRecentWindow("navigator:browser");
    newtab = mainWindow.getBrowser().addTab("chrome://remote-reftest/content/start-testing.html");
    mainWindow.getBrowser().selectedTab = newtab;
  }
}