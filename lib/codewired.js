com.codewired.indix.common = {}

com.codewired.indix.common.htmlScraper = function (data, scraper, browser) {
  this.data    = data;
  this.scraper = scraper;
  this.results = {};
  this.fields  = this.extractFields();
  this.getUrl  = browser.getUrl;
  this.browser = browser;
}

com.codewired.indix.common.htmlScraper.prototype = {

  scrape: function(externalCallback) {
    if (this.scraper.js) return this.jsScrape(this.scraper.js, externalCallback);
    this.scrapeAllFields(externalCallback);
  },

  extractFields: function() {
    var fields = [];
    for (var fieldName in this.scraper)
      fields.push(fieldName);
    return fields;
  },

  scrapeAllFields: function(externalCallback) {
    var field = this.fields.pop();
    if (!field) return externalCallback(this.results);
    var self = this;
    this.scrapeField(field, function(){
      self.scrapeAllFields(externalCallback);
    });
  },

  normalizePrice: function(price) {
    price = price.replace(/[^,.\d]/, '');
    if (this.isNormalPrice(price)) return this.normalizeNormalPrice(price);
    return price;
  },

  isNormalPrice: function(price) {
    return (price.indexOf('.') > -1) && (price.indexOf('.') > price.indexOf(','));
  },

  normalizeNormalPrice: function(price) { // 1,800.99
    price = price.replace(',', '');
    return parseFloat(price);
  },

  normalizeScrapedValue: function(field, scrapedValue) {
    if (!scrapedValue) return;
    scrapedValue = scrapedValue.toString().replace(/[\x00-\x1F"]/g, ''); // replaces control characters and a quote to avoid problems with JSON later
    if (field == 'price') return this.normalizePrice(scrapedValue) || undefined;
    return scrapedValue;
  },

  scrapeField: function(field, callback){
		var self = this;
    this.tryScrapingUsingRegex(field, function() {
			if (self.results[field])
				callback()
			else
				self.tryScrapingUsingJS(field, callback);
		});
  },

  tryScrapingUsingRegex: function(field, callback) {
    if (!this.scraper[field].regex) {
			callback();
			return;
		}
    var scraped = this.regexScrape(this.data, this.scraper[field].regex);
    return this.processScrapedValue(field, scraped, callback);
  },

  tryScrapingUsingJS: function(field, callback) {
    if (!this.scraper[field].js) {
      callback();
      return;
    }
    var self = this;
    this.jsScrape(this.scraper[field].js, function(scrapedValue) {
      self.processScrapedValue(field, scrapedValue, callback);
    });
  },

  processScrapedValue: function(field, scrapedValue, callback) {
    if(!scrapedValue) {
      callback();
      return;
    }
    var scrapedValue = this.normalizeScrapedValue(field, scrapedValue);
    this.results[field] = scrapedValue;
    callback();
    return !!scrapedValue;
  },

  regexScrape: function(html, regex) {
    var match = html.match(new RegExp(regex, 'i'));
    if (match) return match[1];
    return;
  },

  jsScrape: function(js, externalCallback) {
    this.browser.executeJavaScript(js, { html: this.data, getHttp: this.getUrl, callback: externalCallback, scrapeField: this.regexScrape });
  }

}

com.codewired.indix.common.domScraper = function (browser, scraper) {
  this.browser = browser;
  this.$       = browser.jQuery;
  this.address = browser.currentUrl();
  this.scraper = scraper;
  this.results = {}; // we want to keep them since we need to return everything for delayed and volatile scrapers
}

com.codewired.indix.common.domScraper.prototype = {

  scrape: function(externalCallback) {
    var self = this;
    this.browser.getInnerHtml(function(html) {
      self.html = html;
      self.scrapeAllFields(externalCallback);
    });

  },

  /*
  * Most scrapers are syncronous, that's why we are using the for loop and firing the callback before returning
  * If we encounter an asynchronous scraper, the callback will be called one or more times
  * If there are no synchronous scrapers provided, the callback will not be fired immediately
  */
  scrapeAllFields: function(externalCallback) {
    if (this.scraper.js) {
      this.tryScrapingUsingJsAsync(this.scraper.js, externalCallback);
    }
    for (var fieldName in this.scraper) {
      var scrapedValue = this.scrapeField(fieldName, externalCallback);
      if (scrapedValue) {
        this.results[fieldName] = scrapedValue;
      }
    }
    externalCallback(this.results);
  },

  /*
  * If it's possible to scrape syncronously, we just return the value
  * Otherwise we should return undefined and call the externalCallback when the data is ready
  */
  scrapeField: function(field, externalCallback) {
    var timeout = parseInt(this.scraper[field].wait_for || this.scraper[field].rescrape_for); // it's in seconds on the server-side

    return timeout ? this.scrapeChangingField(field, timeout, externalCallback) : this.tryAllScrapingTechniques(field);
  },

  tryAllScrapingTechniques: function(field) {
    var scraper = this.scraper[field];
    return this.tryScrapingUsingRegex(scraper.regex)
        || this.tryScrapingUsingJsSync(scraper.js)
        || this.tryScrapingUrl(scraper.url_param)
        || this.tryScrapingElementContent(scraper.element_text || scraper.form_field)
        || this.tryScrapingMinValue(scraper.min_value)
        || this.tryScrapingSumOfValues(scraper.sum_values);
  },

  tryScrapingSumOfValues: function(selector) {
    if (!selector) return;
    var self = this;
    var sum = 0;

    this.$(selector).each(function(index, element) {
      var floatValue = self.parseFloatAggressively($(element).text());
      if (floatValue) sum += floatValue;
    });

    return Math.round(sum * 100) / 100.0;
  },

  parseFloatAggressively: function(text) {
    return parseFloat(text.replace(/[^\d\.]/g, ""));
  },

  tryScrapingMinValue: function(selector) {
    if (!selector) return;
    var self = this;
    var values = [];

    this.$(selector).each(function(index, element) {
      var floatValue = self.parseFloatAggressively($(element).text());
      if (floatValue) values.push(floatValue);
    });

    if (values.length > 0) return Math.min.apply(Math, values);
  },

  tryScrapingElementContent: function(selector) {
    if (!selector) return;
    var elements = this.$(selector);
    if (elements.length > 0) return elements.eq(0).val() || elements.eq(0).text();
  },

  tryScrapingUrl: function(regex) {
    if (!regex) return;
    var unescaped = unescape(this.address);
    var match = unescaped.match(new RegExp(regex + "=(.+?)&", 'i'));
    if (match) return match[1];
  },

  scrapeChangingField: function(field, timeout, externalCallback) {
    var intervalId,
        intervalInvocations = 0,
        self = this,
        stopWhenScraped = !!this.scraper[field].wait_for;

    intervalId = setInterval(function() {
      if (++intervalInvocations >= timeout) clearInterval(intervalId); // it's ++intervalInvocations because we have to wait 1 sec before the first invocation
      self.results[field] = self.tryAllScrapingTechniques(field);
      if (self.results[field]) {
        if (stopWhenScraped) clearInterval(intervalId);
        externalCallback(self.results);
      }
    }, 1000); // this has to be 1 second since it's specified in seconds on the server-side
  },

  tryScrapingUsingRegex: function(regex) {
    return this.scrapeHtmlUsingRegex(this.html, regex);
  },

  scrapeHtmlUsingRegex: function(html, regex) {
    if (!regex) return;
    html = html.replace(/\ssizcache="\d+"/, "").replace(/\ssizset="\d+"/, "");
    var match = html.match(new RegExp(regex, 'i'));
    if (match) return match[1];
  },

  tryScrapingUsingJsSync: function(jsCode) {
    if (!jsCode) return;

    var results;
    this.jsScrape(jsCode, function(scrape) { results = scrape });
    return results;
  },

  tryScrapingUsingJsAsync: function(jsCode, externalCallback) {
    if (!jsCode) return;
    var self = this;
    this.jsScrape(jsCode, function(scrape) {
      for (field in scrape) {
        self.results[field] = scrape[field];
      }
      externalCallback(self.results);
    });
  },

  jsScrape: function(js, externalCallback) {
    this.browser.executeJavaScript(js, { html: this.html, "$ih": this.$, callback: externalCallback, scrapeField: this.scrapeHtmlUsingRegex });
  }

}

com.codewired.indix.extension = function (browser) {
  this.browser = browser;
  this.properties = {};
  this.notificationsCount = {};
  this.messageQueue = [];
  this.trackingDivId = "tc_container";
  this.executionCancelled = null;
};

com.codewired.indix.extension.prototype = {

    htmlScraper: function (data, scraper) {
        return new com.codewired.indix.common.htmlScraper(data, scraper, this.browser);
    },

    domScraper: function (scraper) {
        return new com.codewired.indix.common.domScraper(this.browser, scraper);
    },

    notifyIframeReady: function(){
      this.iframeReady = true;
      this.processMessageQueue();
    },

    processMessageQueue: function(){
      while(this.messageQueue.length > 0){
        var message = this.messageQueue.shift()
        this.postMessage(message);
      }
    },

    queueMessage: function(message){
      if(this.iframeReady) {
        this.postMessage(message);
      } else {
        this.messageQueue.push(message);
      }
    },

    postMessage: function(message){
      this.browser.postMessage(message);
    },

    showNotification: function (iFrameAddress, notification, overridingStylesheet) {
        if (this.browser.competingIframeInjected(iFrameAddress)) {
            this.browser.removeIframe();
        }

        this.browser.insertIframe(iFrameAddress, this);

        this.queueMessage(notification || {});

        if (overridingStylesheet) {
            this.browser.injectStylesheet(overridingStylesheet);
        }
    },

    installationSource: function () {
        return this.properties.source;
    },

    hideNotification: function () {
        this.browser.removeIframe();
    },

    runAll: function (params) {
          var self = this;
          setTimeout(function() { // timeout is to allow other extenions to run
           self.browser.removeIframe();
           new com.codewired.indix.products(self, params.extensionOptions).run();
          }, 100);
        },

        shouldRun: function() {
          return true;
        },

        run: function (params) {
            var self = this;
            self.runAll(params);
        }
}


com.codewired.indix.currentPage = function (retailers, options, browser, extension) {
  this.retailer = retailers.getRetailer();
  this.url = browser.currentUrl();
  this.retailers = retailers;
  this.options = options;
  this.browser = browser;
  this.extension = extension;
  this.scrapeResult = {};
}

com.codewired.indix.currentPage.prototype = {

  price: function(){
    return this.scrapeResult.price;
  },

  invalidGenericScrape: function(scrape){
    return !scrape || !(scrape.asin || scrape.product_query) || !scrape.region
  },

  currentScrapeFailed: function(retailer, scrapeResult) {
    if (retailer.category == "search_engine")
      return !scrapeResult || !(scrapeResult.asin || scrapeResult.product_query);
    if (retailer.category == "generic")
      return this.invalidGenericScrape(scrapeResult);
    return !scrapeResult || !(scrapeResult.price || scrapeResult.title);
  },

  scrapePage: function(scrapingCallback) {
    this.alternative = this.alternativeFactory.alternativeFor(this.retailer, {scraping_address:this.url});
    var scrapeHandler = this.alternative.scrapeHandler(scrapingCallback);

    if (this.retailer.use_inner_html) {
      this.browser.getInnerHtml(scrapeHandler);
    } else {
      this.browser.getUrl(this.url, scrapeHandler);
    }
  },

  toJson: function(){
    return JSON.stringify(this.scrapeResult);
  },

  similarItemsCallback: function(items, notification){
    notification.sendMessage({relatedProducts: items});
  },

  fetchSimilarItems: function(notification){
    if (this.alternative.shouldFetchSimilarItems(this.scrapeResult)){
      var self = this;
      this.relatedProducts.fetchSimilarItems(self.scrapeResult.title, function(items){
        self.similarItemsCallback(items, notification);
      });
    }
  },

  scrape: function(callback) {
    if (!this.retailer) {
      return;
    }

    var self = this;
    var scrapeHandler = function(scrapeResult) {
      self.scrapeResult = scrapeResult;
      callback && callback(self.currentScrapeFailed(self.retailer, scrapeResult), self);
    };

    this.scrapePage(scrapeHandler);
  }
}

com.codewired.indix.retailers = function (browser) {
    this.browser = browser;
    this.retailersUrl = 'http://scrapers.invisiblehand.co.uk/retailers';
    this.retailersCache = {};
}

com.codewired.indix.retailers.prototype = {

  parseProductsData: function(parsedReply) {
    var regions = parsedReply.regions;
    var retailersList = this.parseRetailers(parsedReply.all_retailers, regions);
    com.codewired.indix.log('Got: ' + retailersList.length + ' retailers');
    var productsData = {"regions" : regions, "genericRetailerObject" : parsedReply.generic, "retailersList" : retailersList}
    this.browser.cache("productsData", productsData);
    this.productsData = productsData;
  },

  fetchRetailers: function (callback) {
    com.codewired.indix.log("Fetching retailers from server");
    var self = this;
    if (this.browser.browserType() != 'opera') { // special condition for opera
      this.browser.getUrl(this.retailersUrl, function(data) {
        self.parseProductsData(JSON.parse(data));
        if (callback) callback(self.retailers());
      });
    } else { // opera, taking scrapers from file
      this.parseProductsData(com.forward.scrapers.retailers);
      if (callback) callback(this.retailers());
    }
  },

  parseRetailers: function(fullRetailersList, regions){
    var retailersList = []
    for (var i=0; i < fullRetailersList.length; i++) {
      var retailer = fullRetailersList[i];
      if (retailer.region) {
        retailer.region = regions[retailer.region.toLowerCase()];
      }
      retailersList.push(retailer);
    }
    return retailersList;
  },

  regionFor: function(region_code){
    return this.productsData.regions[region_code];
  },

  retailers: function() {
    return this.productsData.retailersList;
  },

  genericRetailer: function() {
    return this.productsData.genericRetailerObject;
  },

  getRetailer: function(address, currentPage) {
    var region_code = currentPage ? currentPage.scrapeResult.region : undefined;
    address = address || this.browser.currentUrl();
    var retailer = this.findRetailer(address);
    if (!retailer && (address == this.browser.currentUrl())) {
      retailer = this.genericRetailer();
    }
    if (retailer && !retailer.region && region_code) {
      retailer.region = this.regionFor(region_code);
    }
    return retailer;
  },

  findRetailer: function(address){
    if (this.retailersCache[address]) return this.retailersCache[address];

    var retailers = this.retailers();
    if (!retailers) throw "The list of retailers must already have been fetched";
    for (var i = 0; i < retailers.length; i++) {
      var r = retailers[i];
      if (address.match(new RegExp(r.regex), 'i')) {
        this.retailersCache[address] = r;
        return r;
      }
    }
  },

  fetchCachedRetailers: function(callback) {
    var self = this;
    this.browser.cache("productsData", function(productsData) {
      if (productsData) {
        self.productsData = productsData;
        callback && callback(self.retailers());
      } else {
        self.fetchRetailers(callback);
      }
    });
  }
}


com.codewired.indix.notification = function(browser, extension, retailers) {
  this.browser = browser;
  this.extension = extension;
  this.retailers = retailers;
  var domain = extension.properties.domain || "invisiblehand.co.uk";
  this.iFrameAddress = "http://productsiframe." + domain + "/";
}

com.codewired.indix.notification.prototype = {

  showEarlyNotification: function(numberOfAlternatives){
    if(numberOfAlternatives >= 3) this.sendMessage({})
  },

  retailer: function(currentPage){
    return this.retailers.getRetailer(undefined, currentPage);
  },

  sendMessage: function(message) {
    var url = message.region ? this.iFrameAddress + "&region=" + message.region.code  : this.iFrameAddress;
    this.extension.showNotification(url, message, this.retailer().style_override);
  },

  sendCurrentPage: function(pageViewId, currentPage) {
    var message = {
      url: this.browser.currentUrl(),
      scrape: currentPage.scrapeResult,
      settingsLink: this.extension.properties.settingsLink
    }
    this.sendMessage(message);
  }

}


com.codewired.indix.products = function(extension, options) {
  this.options = options;
  this.extension = extension;
  this.browser = extension.browser;
  this.retailers = new com.codewired.indix.retailers(extension.browser);
}

com.codewired.indix.products.prototype = {

  scrapeCurrentPage: function(callback) {
    var currentPage = new com.codewired.indix.currentPage(this.retailers, this.options, this.browser, this.extension);
    currentPage.scrape(callback);
  },

  run: function() {
    var self = this;
    self.retailers.fetchRetailers();
    self.scrapeCurrentPage();
  }
}
