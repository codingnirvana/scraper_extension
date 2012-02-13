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
  this.iFrameHeight = 31; // px. This is not a constant, the iFrame can change this
  this.stylesheetId = 'indix-overriding-stylesheet';
}

com.codewired.indix.browser.prototype = {
  receiveMessage: function(evt) {    
    var iFrame = document.getElementById(com.codewired.indix.iFrameId);
    if (!evt.data) {
      return;
    }
    if (!iFrame) {
      com.codewired.indix.log("iframe " + com.codewired.indix.iFrameId + " not found.")
      return;
    }
    try {
      var payload = JSON.parse(evt.data);
    } catch(e) {
      var payload = {};
    }
    switch(payload.message) {
      case 'closeNotification':
        // this.shiftBody();
        this.removeIframe();
      break;
      case 'expandIframe':
        iFrame.style.height = '100%';
        break;
      case 'iframeReady':
        this.notifyIframeReady();
        break;
      case 'showNotification':
      case 'collapseIframe':
        this.iFrameHeight = payload.notificationHeight || this.iFrameHeight;
        iFrame.style.height = this.iFrameHeight + 'px';
        this.shiftBody(this.iFrameHeight);  		  
        this.applyStylesheet();
        break;
      default:
        // console.log("Don't know what to do with: " + payload.message);
    }
	},	

  postMessage: function(notification){
    var scriptElement = this.scriptElement(notification);
    var head = this.doc.getElementsByTagName("head").item(0);
    head.appendChild(scriptElement);
    head.removeChild(scriptElement);
  },
  
  scriptElement: function(notification) {
    var message = JSON.stringify(notification).replace(/'/g, '\\\'');
    var scriptElement = this.doc.createElement("script");
    scriptElement.type = 'text/javascript';     
    scriptElement.id = 'indix-message-posting-script';
    scriptElement.text = "var e=document.getElementById('indix-iframe'); if (e) {e.contentWindow.postMessage('" + message + "', '*')};";    
    return scriptElement;
  },
  
  injectStylesheet: function(stylesheet) {
    this.overridingStylesheet = stylesheet;
  },
  
  applyStylesheet: function() {
    var processedStylesheet = this.processStylesheet(this.overridingStylesheet);
    var stylesheetElement = this.stylesheetElement(processedStylesheet);
    var head = this.doc.getElementsByTagName("head").item(0);    
    this.jQuery('#' + this.stylesheetId).remove();    
    head.appendChild(stylesheetElement);
  },
  
  removeStylesheet: function() {
    this.jQuery('#' + this.stylesheetId).remove();
  },
  
  processStylesheet: function(stylesheet) {
    var height = this.notificationHeight();
    var regex = new RegExp(/<<([-\d]+)>>/g);
    var match;
    var newCss = stylesheet;
    while (match = regex.exec(stylesheet)) {
      var newHeight = parseInt(match[1]) + height;
      newCss = newCss.replace(match[0], newHeight);
    }
    return newCss;    
  },
  
  stylesheetElement: function(stylesheet) {
    var styleElement = this.doc.createElement("style");
    styleElement.type = 'text/css';     
    styleElement.id = this.stylesheetId;
    styleElement.appendChild(this.doc.createTextNode(stylesheet));
    return styleElement;
  },
  
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
  
  removeIframe: function() {
    this.removeStylesheet();    
    //this.shiftBody();
    this.jQuery('#indix-iframe').remove();    
  },
  
  competingIframeInjected: function(url) {
    var iFrameUrl = this.jQuery('#indix-iframe').attr('src');
    return url && iFrameUrl && (iFrameUrl.indexOf(url) == -1);
  },
  
  notifyIframeReady: function(){
	  if(this.listener) this.listener.notifyIframeReady();
	},
  
  insertIframe: function(url, listener) {
    this.listener = listener;
    if (this.idExists('indix-iframe')) return;
    this.shiftBody(); // shifts it back to where it was    
    this.originalBodyMarginTop = this.doc.body.style.marginTop;    

    var iframe = this.doc.createElement("iframe");    
    iframe.id = 'indix-iframe';
    iframe.src = url;
    iframe.scrolling = 'no';
    iframe.frameBorder = '0';
    iframe.width = '100%';
    iframe.height = '0px';
    iframe.width = '100%';
    iframe.style.position = 'fixed';
    iframe.style.zIndex = '100001';
    iframe.style.left = 0;
    iframe.style.right = 0;
    iframe.style.top = 0;
    iframe.style.width = '100%';
    this.doc.body.insertBefore(iframe, this.doc.body.firstChild);
  },

  insertHiddenIframe: function(url, id) {
    if (this.idExists(id)) return;
    var iframe = this.doc.createElement("iframe");    
    iframe.id = id;
    iframe.src = url;
    iframe.scrolling = 'no';
    iframe.frameBorder = '0';
    iframe.width = '0px';
    iframe.height = '0px';
    iframe.style.position = 'absolute';
    iframe.style.display = 'none';
    this.doc.body.insertBefore(iframe, this.doc.body.firstChild);
  },
  
  shiftBody: function(height) {      
    this.doc.body.style.marginTop = height === undefined ? this.originalBodyMarginTop : (((parseInt(this.originalBodyMarginTop) || 0) + height) + 'px');
  },
  
  windowHeight: function() {
    return this.window.innerHeight;
  },
  
  notificationHeight: function() {
    return this.iFrameHeight;
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
