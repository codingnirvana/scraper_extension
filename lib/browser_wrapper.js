if (!com) var com = {};
if (!com.codewired) com.codewired = {};

com.codewired.indix = {

  quiet: true,
  iFrameId: 'codewired-iframe',
	version: "0.0.1",
  ext: null,

  log: function (message) {
    var debugModeEnabled = this.ext && this.ext.properties && this.ext.properties.debugModeEnabled === "true";
    (!this.quiet || debugModeEnabled) && console.log(message);
  },
  
  httpRequest: function (url, options) {
    var method = (options && options.method) || "GET";
    var callback = (options && options.callback) || false;
    
    chrome.extension.sendRequest({ topic: 'htmlRequest', location: { href: url }, method: method }, function (response) { 
      callback && callback(response);
    });
  },
    
  bootStrap: function(url) {
    if (url != this.lastBootStrapUrl) {
      this.lastBootStrapUrl = url;
      com.codewired.indix.log("bootstraping for " + url);
      chrome.extension.sendRequest({ topic: 'run' }, com.codewired.indix.run);
    }
  },
 
  run: function(params) {
    var browser = com.codewired.indix.browserInstance = com.codewired.indix.browserInstance || new com.codewired.indix.browser(document);
    window.addEventListener("message", function(evt) {browser.receiveMessage(evt)}, false);	// the wrapper function is used to change the context from DOMWindow to browser to use the 'this' keyword
    this.ext = new com.codewired.indix.extension(browser);
    this.ext.run(params);
  }
};

com.codewired.indix.browser = function (doc) {
  this.doc = doc;
  this.window = doc.defaultView;
  this.jQuery = jQuery;
}

com.codewired.indix.browser.prototype = {

  getInnerHtml: function(callback) {
    var self = this;
    setTimeout(function() {callback(self.doc.body.innerHTML)}, 300);
  },

  getUrl: function(url, callback) {
    com.codewired.indix.httpRequest(url, { callback: callback });
  },

  report: function(url) {
    com.codewired.indix.httpRequest(url, { method: 'POST' });
  },

  currentUrl: function () {
    return this.doc.location.href;
  },

  idExists: function (nodeId) {
    return this.doc.getElementById(nodeId) != null;
  },

  setHtml: function (nodeId, html) {
    this.doc.getElementById(nodeId).innerHTML = html;
  },

  browserType: function() {
    return 'chrome';
  },
  
  extensionVersion: function() {
    return com.codewired.indix.version;
  },

  createRootElement: function (id) {
    this.root = this.doc.createElement("div");
    this.root.id = id;
    this.doc.body.insertBefore(this.root, this.doc.body.firstChild);
  },

  navigateToPage: function (url) {
    if (url && url != "" && url != "none") {
      chrome.extension.sendRequest({ topic: 'opennewtab', address: url });
    }
  },

  cache: function(key, value, callback) {
    if ((callback == undefined) && (typeof value == "function")) {
      callback = value;
      value = undefined;
    }
    if (!callback) callback = function() {};
    chrome.extension.sendRequest({ topic: 'cache', key: key, value: value}, callback);
  },
  
  executeJavaScript: function(js, context) {
    var args = [];
    var values = [];
    
    for (var arg in context) {
      args.push(arg);
      values.push(context[arg]);
    }
          
    var f = new Function(args.join(","), js);
    f.apply(null, values);
  }

};

chrome.extension.onRequest.addListener(
  function (request, sender, sendResponse) {
    switch (request.topic) {
      case 'refreshed':
        com.codewired.indix.bootStrap(request.url);
        break;
      default:
        break;
    }
  }
);

com.codewired.indix.bootStrap(document.location.href);
