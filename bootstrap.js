const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

const PANEL_ID = "org.digdug.twitter";
const DATASET_ID = "org.digdug.twitter.items";
const TWITTER_URL = "https://mobile.twitter.com";
const XMLHttpRequest = Components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1", "nsIXMLHttpRequest");

Cu.import("resource://gre/modules/Home.jsm");
Cu.import("resource://gre/modules/HomeProvider.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

var Twitter = {
	getItems: function(callback) {
		var items = [];
		let win = getChromeWindow();
		let self = this;
		this.load(win, TWITTER_URL).then(function(data) {
			callback(data);
		}, function(err) {
			Services.console.logStringMessage(err);
		});
	},

	_browser: null,
	_timeout: null,
	load: function(window, url, type, headers, responseType, params) {
		var self = this;

		return new window.Promise(function(resolve, reject) {
			if (!self._browser) {
				self._browser = window.document.createElement("browser");
				self._browser.setAttribute("type", "content");
				self._browser.setAttribute("collapsed", "true");

				window.document.documentElement.appendChild(self._browser);
				self._browser.stop();

				self._browser.webNavigation.allowImages = false;
				self._browser.webNavigation.allowMetaRedirects = true;

				self._browser.addEventListener("DOMContentLoaded", function (event) {
					try {
						Services.console.logStringMessage(event.type);
						self._parseBrowser(window, resolve, reject, event);
					} catch(ex) {
						Cu.reportError(ex);
					}
				});

				self._browser.loadURIWithFlags(url, Ci.nsIWebNavigation.LOAD_FLAGS_NONE, null, null, null);
			} else {
				window.clearTimeout(self._timeout);
				self._parseBrowser(window, resolve, reject);
			}
		});
	},

	_removeBrowser: function() {
		Services.console.logStringMessage(this._browser);
		if (this._browser) {
			this._browser.parentElement.removeChild(this._browser);
			this._browser = null;
		}
	},

	_parseBrowser: function(window, resolve, reject, event) {
		var doc = this._browser.contentDocument;

		// ignore on frames and other documents
		if (event && event.target != this._browser.contentDocument)
			return;

		let self = this;
		if (doc.location.href == "about:blank") {
			resolve(null);
			this._timeout = window.setTimeout(function() { self._removeBrowser(); }, 10000);
			return;
		}

		window.setTimeout(function() {
			var items = [];
			var tweets = self._browser.contentDocument.querySelectorAll(".stream-tweet");
			if (!tweets || tweets.length == 0) {
				resolve(null);
				return;
			}

			for (var i = 0; i < tweets.length; i++) {
				var tweet = tweets[i];

				var name = tweet.querySelector(".full-name").textContent;
				var descr = tweet.querySelector(".tweet-text").textContent;
				var screenname = tweet.querySelector(".screen-name").textContent;
				var url = tweet.querySelector(".tweet-text a");
				if (url) url = url.getAttribute("data-url");
				var url2 = TWITTER_URL + tweet.getAttribute("href");

				var image = tweet.querySelector("avatar");
				if (image) {
					image = "http:" + image.getAttribute("src");
				}

				items.push({
					title: name,
					description: descr,
					image_url:  image,
					url: url || url2
				});

				resolve(items);

				// Request has finished with error, remove browser element
				self._timeout = window.setTimeout(function() { self._removeBrowser(); }, 10000);
			}
		}, 5000);
	},

	isAuthenticated: function() {
		var retval = null;
		this._removeBrowser();

		Twitter.load(getChromeWindow(), TWITTER_URL).then(function(data) {
			retval = (data != null);
		}, function(err) {
			retval = false;
		});

		let thread = Services.tm.currentThread;
		while (retval === null)
			thread.processNextEvent(true);

		Services.console.logStringMessage("isAuth? " + retval);
	  	return retval;
	},

	authenticate: function(callback) {
		Services.console.logStringMessage("Authenticate");
		if (this.isAuthenticated()) {
			Services.console.logStringMessage("Authenticate done!");
			callback();
			return;
		}

		var self = this;
		var tab = getChromeWindow().BrowserApp.addTab(TWITTER_URL + "/session/new");
		tab.browser.addProgressListener({
			onLocationChange: function(aWebProgress, aRequest, aLocation, aFlags) {
			},
			onProgressChange: function(aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress) {
			},
			onSecurityChange: function(aWebProgress, aRequest, aState) {
			},
			onStateChange: function(aWebProgress, aRequest, aStateFlags, aStatus) {
				// Filter optimization: Only really send NETWORK state changes to Java listener
				if (!(aStateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK)) {
					return;
				}

				if (!(aStateFlags & Ci.nsIWebProgressListener.STATE_STOP)) {
					return;
				}

				Services.console.logStringMessage("State done");
				if (self.isAuthenticated()) {
					tab.browser.removeProgressListener(this);
					tab.browser.contentWindow.close();
					Home.panels.update(PANEL_ID);
					callback();
				}
			},
			onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage) {
			},
			QueryInterface: function(aIID) {
				if (aIID.equals(Components.interfaces.nsIWebProgressListener) ||
					aIID.equals(Components.interfaces.nsISupportsWeakReference) ||
					aIID.equals(Components.interfaces.nsISupports))
					return this;
				throw Components.results.NS_NOINTERFACE;
			},
		});
	}
}

function openPanel() {
	Services.wm.getMostRecentWindow("navigator:browser").BrowserApp.loadURI("about:home?page=" + PANEL_ID);
}

function updateData(callback) {
	Services.console.logStringMessage("Update data");
	Twitter.getItems(function(list) {
		Services.console.logStringMessage("Got data");
		saveItems(list, callback);
	});
}

function saveItems(items, callback) {
	Task.spawn(function() {
		let storage = HomeProvider.getStorage(DATASET_ID);
		yield storage.deleteAll();

		if (items)
			yield storage.save(items);
	}).then(callback, e => Cu.reportError("Error saving Twitter items to HomeProvider: " + e));
}

function deleteItems() {
	Task.spawn(function() {
		let storage = HomeProvider.getStorage(DATASET_ID);
		yield storage.deleteAll();
	}).then(null, e => Cu.reportError("Error deleting Twitter items from HomeProvider: " + e));
}

function getChromeWindow() {
	return Services.wm.getMostRecentWindow("navigator:browser");
}

function startup(aData, aReason) {
	function optionsCallback() {
		return {
			id: PANEL_ID,
			title: "Twitter",
			layout: Home.panels.Layout.FRAME,
			views: [{
				type: Home.panels.View.LIST,
				dataset: DATASET_ID,
				itemType: Home.panels.Item.ARTICLE,
			}],
			authHandler: {
				isAuthenticated: function() {
					return Twitter.isAuthenticated();
				},

				authenticate: function() {
					Twitter.authenticate();
				},

				messageText: "Please log in to Twitter",
				buttonText: "Log in",
				imageUrl: "drawable://icon_reading_list_empty"
			}
		};
	}

	// Always register a panel and a periodic sync listener.
	Home.panels.register(PANEL_ID, optionsCallback);
	HomeProvider.addPeriodicSync(DATASET_ID, 3600, updateData);

	switch(aReason) {
		case ADDON_ENABLE:
		case ADDON_INSTALL:
			Home.panels.install(PANEL_ID);
			Twitter.authenticate(() => updateData(openPanel));
			break;
		case ADDON_UPGRADE:
		case ADDON_DOWNGRADE:
			Home.panels.update(PANEL_ID);
			updateData(openPanel);
			break;
	}
}

function shutdown(aData, aReason) {
  if (aReason == ADDON_UNINSTALL || aReason == ADDON_DISABLE) {
    deleteItems();
    Home.panels.uninstall(PANEL_ID);
  }

  Home.panels.unregister(PANEL_ID);
}

function install(aData, aReason) {
}

function uninstall(aData, aReason) {
	deleteItems();
}
