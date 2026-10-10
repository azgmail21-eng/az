const HOST_NAME = "com.arena.documents";
const AGENT_URL = /^https:\/\/arena\.ai\/agent(?:[/?#]|$)/i;
const REQUEST_TIMEOUT_MS = 30_000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "arena-documents-request") return false;

  const senderUrl = sender.url || sender.tab?.url || "";
  if (!AGENT_URL.test(senderUrl)) {
    sendResponse({ ok: false, error: "Seule la page Agent Mode d'arena.ai peut utiliser ce pont." });
    return false;
  }

  let port;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (error) {
    sendResponse({ ok: false, error: error?.message || String(error) });
    return false;
  }

  let answered = false;
  const finish = (response) => {
    if (answered) return;
    answered = true;
    clearTimeout(timeout);
    sendResponse(response);
    try {
      port.disconnect();
    } catch {
      // Le port est peut-être déjà fermé.
    }
  };

  const timeout = setTimeout(() => {
    finish({ ok: false, error: "Le pont local n'a pas répondu à temps." });
  }, REQUEST_TIMEOUT_MS);

  port.onMessage.addListener((response) => finish(response));
  port.onDisconnect.addListener(() => {
    if (answered) return;
    const error = chrome.runtime.lastError?.message;
    finish({
      ok: false,
      error:
        error ||
        "Le Native Host s'est déconnecté sans répondre. Vérifie l'installation, puis redémarre complètement Edge.",
    });
  });

  try {
    port.postMessage(message.payload);
  } catch (error) {
    finish({ ok: false, error: error?.message || String(error) });
  }

  return true; // sendResponse est appelé de manière asynchrone.
});
