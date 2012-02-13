chrome.extension.onRequest.addListener(function (request, sender, sendResponse) {
  codewired.handleExtensionRequest(request, sender, sendResponse);
});