chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  if (changeInfo.url) {
    setTimeout(function() {
      chrome.tabs.sendRequest(tabId, {topic: "refreshed", url: changeInfo.url}, function(response) {});
    }, 500)
  }
});

codewired = {
  handleExtensionRequest: function(request, sender, sendResponse) {
    switch (request.topic) {
      case 'opennewtab':
        chrome.tabs.create({ url: request.address });
        break;
      case 'run':                     
        sendResponse({});
        break;
      case 'cache':
          sendResponse(cache(request.key, request.value));
          break;
      case 'htmlRequest':
        ajaxRequest(request.location.href, request.data, request.method, function (xhr) {
            sendResponse(xhr.responseText);
        });
        break;
      default:
        sendResponse({});
    }
  }    
}        

function ajaxRequest(url, data, method, successCallback) {
  var xhr = new XMLHttpRequest();
  xhr.onreadystatechange = function () {
    if ((xhr.readyState == 4) && successCallback) successCallback.call(this, xhr);
  };
  xhr.open(method, url, true);
  xhr.send(data);
}
