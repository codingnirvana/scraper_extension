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
};

com.codewired.indix.extension.prototype = {

    htmlScraper: function (data, scraper) {
        return new com.codewired.indix.common.htmlScraper(data, scraper, this.browser);
    },

    domScraper: function (scraper) {
        return new com.codewired.indix.common.domScraper(this.browser, scraper);
    },

    showNotification: function (title, message) {
        chrome.extension.sendRequest({ topic: 'shownotification', title:title, message: message });
    },

    runAll: function (params) {
          var self = this;
          setTimeout(function() { // timeout is to allow other extenions to run
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


com.codewired.indix.currentPage = function (browser, extension) {
  this.url = browser.currentUrl();
  this.browser = browser;
  this.extension = extension;
  this.scrapeResult = {};
  // TODO: Get this from the server.
  this.scraper = { "price" : { "regex" : "<span class=\"small-font\".+?>(.+?)</span>" },
                   "title" : { "regex" : "<h1 itemprop=\"name\".+?>(.+?)</h1>" }
                 };
}

com.codewired.indix.currentPage.prototype = {

  price: function(){
    return this.scrapeResult.price;
  },

  title: function() {
    return this.scrapeResult.title;
  },

  scrapePage: function(scrapeCallback) {
    var self = this;
    var scrapeHandler = function(html) {
        var s = new com.codewired.indix.common.htmlScraper(html, self.scraper, self.browser);
        s.scrape(scrapeCallback);
    }

    this.browser.getInnerHtml(scrapeHandler);

  },

  toJson: function(){
    return JSON.stringify(this.scrapeResult);
  },

  scrape: function(callback) {
    var self = this;
    var scrapeHandler = function(scrapeResult) {
      self.scrapeResult = scrapeResult;
      callback && callback(self);
    };

    this.scrapePage(scrapeHandler);
  }
}

com.codewired.indix.products = function(extension, options) {
  this.options = options;
  this.extension = extension;
  this.browser = extension.browser;
  // TODO: Host this on Heroku
  this.priceListUrl = 'http://localhost:3000/search?name=';
}

com.codewired.indix.products.prototype = {

  fetchPriceList: function (result, callback) {
      com.codewired.indix.log("Fetching priceList from server");
      var self = this;
      this.browser.getUrl(this.priceListUrl + result.title, function(data) {
        if (callback) callback(JSON.parse(data));
      });
    },

  scrapeCurrentPage: function(callback) {
    var currentPage = new com.codewired.indix.currentPage(this.browser, this.extension);
    currentPage.scrape(callback);
  },

  run: function() {
    var self = this;

    self.scrapeCurrentPage(function(currentPage) {
      self.fetchPriceList( currentPage.scrapeResult, function(data) {
          if (parseInt(currentPage.scrapeResult.price) > parseInt(data.price)) {
            self.extension.showNotification("Cheaper price available elsewhere",
            data.sitename + "(Rs." + data.price + ")");
          }  else {
            self.extension.showNotification("Flipkart is the cheapest", "");
          }
      });
    });
  }
}
