/* Arena Saver — service worker : téléchargements directs (secours). */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'ars-download-url') return false;
  chrome.downloads.download(
    { url: msg.url, filename: msg.filename, saveAs: false },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, downloadId });
      }
    }
  );
  return true; // réponse asynchrone
});
