const HOST_NAME = "com.localbridge.filehost";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "fb-request") return false;

  let port;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (e) {
    sendResponse({ ok: false, error: String(e) });
    return false;
  }

  let answered = false;

  port.onMessage.addListener((response) => {
    answered = true;
    sendResponse(response);
    port.disconnect();
  });

  port.onDisconnect.addListener(() => {
    if (!answered) {
      const err = chrome.runtime.lastError
        ? chrome.runtime.lastError.message
        : "Le Native Host s'est déconnecté sans répondre (vérifie qu'il est bien installé et que le navigateur a été redémarré).";
      sendResponse({ ok: false, error: err });
    }
  });

  port.postMessage(msg.payload);
  return true; // réponse asynchrone
});
