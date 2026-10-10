// Arena FS — popup : connexion du dossier, test, déconnexion.
import { saveRootHandle, loadRootHandle } from "./db.js";

const $ = (id) => document.getElementById(id);

function sendBg(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (resp) => resolve(resp || { ok: false, error: "Pas de réponse." }));
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

async function refresh() {
  const status = $("status");
  const root = await loadRootHandle();
  if (!root) {
    status.textContent = "Aucun dossier connecté.";
    status.className = "status";
    await chrome.storage.local.remove("rootName");
    return;
  }
  let perm = "unknown";
  try {
    perm = await root.queryPermission({ mode: "readwrite" });
  } catch {
    /* ignore */
  }
  await chrome.storage.local.set({ rootName: root.name });
  if (perm === "granted") {
    status.textContent = `✅ Dossier connecté : « ${root.name} » — l'IA peut y lire/écrire librement, sans autre autorisation.`;
    status.className = "status on";
  } else {
    status.textContent = `⚠️ Dossier « ${root.name} » connecté mais permission ${perm}. Re-cliquez sur « Choisir le dossier » pour réautoriser.`;
    status.className = "status warn";
  }
}

$("pick").addEventListener("click", async () => {
  const out = $("output");
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await saveRootHandle(handle);
    await refresh();
    out.textContent = `✅ Dossier « ${handle.name} » connecté. L'IA peut maintenant y créer des dossiers et des fichiers sans autorisation supplémentaire.`;
  } catch (e) {
    if (e && e.name !== "AbortError") out.textContent = "❌ " + e.message;
  }
});

$("test").addEventListener("click", async () => {
  const out = $("output");
  const content =
    "Fichier de test créé par l'extension Arena FS.\n" +
    `Date : ${new Date().toLocaleString()}\n\n` +
    "Si vous lisez ceci, l'IA d'Arena.ai peut écrire dans vos Documents sans autorisation supplémentaire.\n";
  const resp = await sendBg({
    op: "write",
    path: "Arena-AI/fichier-test.txt",
    encoding: "text",
    content,
  });
  out.textContent =
    resp && resp.ok
      ? `✅ Fichier de test écrit : <dossier connecté>/Arena-AI/fichier-test.txt (${resp.result.bytes} octets)`
      : "❌ " + (resp && resp.error);
});

$("clear").addEventListener("click", async () => {
  await sendBg({ op: "clear" });
  await chrome.storage.local.remove("rootName");
  await refresh();
  $("output").textContent = "Dossier déconnecté. L'IA n'a plus accès à rien.";
});

const chkPanel = $("chk-panel");
{
  const stored = await chrome.storage.local.get("arenaFsPanelHidden");
  chkPanel.checked = stored.arenaFsPanelHidden !== true;
}
chkPanel.addEventListener("change", async (e) => {
  await chrome.storage.local.set({ arenaFsPanelHidden: !e.target.checked });
});

refresh();
