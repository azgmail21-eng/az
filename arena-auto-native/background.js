/* Arena Auto Native — relais vers le host natif (verrouillé sur Documents). */
const HOST_NAME = "com.arenaauto.filehost";
const TIMEOUT_MS = 30000;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "aan-request") return false;

  let port;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (e) {
    sendResponse({
      ok: false,
      error: "Host natif introuvable (" + (e && e.message ? e.message : e) + "). " +
        "Installe-le : voir arena-auto-host/README.md, puis redémarre Edge complètement."
    });
    return false;
  }

  let answered = false;
  const timer = setTimeout(() => {
    if (answered) return;
    answered = true;
    try { port.disconnect(); } catch (e) { /* ignore */ }
    sendResponse({ ok: false, error: "Le host natif ne répond pas (timeout 30 s)." });
  }, TIMEOUT_MS);

  port.onMessage.addListener((response) => {
    if (answered) return;
    answered = true;
    clearTimeout(timer);
    sendResponse(response);
    try { port.disconnect(); } catch (e) { /* ignore */ }
  });

  port.onDisconnect.addListener(() => {
    if (answered) return;
    answered = true;
    clearTimeout(timer);
    const err = chrome.runtime.lastError
      ? chrome.runtime.lastError.message
      : "Host déconnecté sans répondre (non installé ? navigateur non redémarré après install ?).";
    sendResponse({ ok: false, error: err });
  });

  try {
    port.postMessage(msg.payload);
  } catch (e) {
    if (!answered) {
      answered = true;
      clearTimeout(timer);
      sendResponse({ ok: false, error: "Envoi au host impossible : " + e.message });
    }
  }
  return true; // réponse asynchrone
});
