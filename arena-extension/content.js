// Arena FS — script de contenu (monde isolé) sur arena.ai.
// Rôles :
//   1. Relier la page (window.arenaFS) au service worker de l'extension.
//   2. Détecter les lignes « ARENAFS_ACTION: {...} » dans les messages de l'IA
//      et les exécuter AUTOMATIQUEMENT, sans confirmation (lecture, écriture,
//      création de dossiers, liste, suppression) — tout en restant dans le
//      dossier connecté (ex. Documents).
//   3. Afficher un petit panneau de journal/statut en bas à droite.
//   4. Insérer les résultats dans le champ de saisie du chat (il ne reste plus
//      qu'à appuyer sur Envoyer pour que l'IA voie le résultat).

(() => {
  "use strict";

  const REQ_SOURCE = "arena-fs-page";
  const RES_SOURCE = "arena-fs-bg";
  const ACTION_MARKER = "ARENAFS_ACTION:";
  const ACTION_RE = /^[ \t]*ARENAFS_ACTION:[ \t]*(\{.*\})[ \t]*$/;
  const MAX_CONTENT_INSERT = 8000; // caractères max insérés dans le chat
  const VALID_ACTIONS = ["write", "read", "mkdir", "list", "exists", "remove"];

  const state = {
    autoExec: true,
    autoInsert: true,
    panelHidden: false,
    lastResult: null,
  };
  const processed = new Set();

  /* ---------------- communication avec le service worker ---------------- */

  function sendBg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError && !resp) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp || { ok: false, error: "Aucune réponse du service worker." });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  /* ---------------- relais page <-> service worker ---------------- */

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.source !== REQ_SOURCE || data.type !== "request") return;
    const resp = await sendBg({ ...(data.args || {}), op: data.op });
    window.postMessage(
      {
        source: RES_SOURCE,
        type: "response",
        id: data.id,
        ok: !!(resp && resp.ok),
        result: resp ? resp.result : null,
        error: resp ? resp.error : "Erreur inconnue",
      },
      "*"
    );
  });

  /* ---------------- exécution automatique des actions de l'IA ---------------- */

  function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function insertIntoComposer(text) {
    const editable = document.querySelector(
      '[contenteditable="true"], [contenteditable="plaintext-only"]'
    );
    if (editable) {
      editable.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      return document.execCommand("insertText", false, text + "\n");
    }
    const ta = document.querySelector("textarea");
    if (ta) {
      ta.focus();
      const end = ta.value.length;
      ta.setSelectionRange(end, end);
      return document.execCommand("insertText", false, text + "\n");
    }
    return false;
  }

  async function executeAction(jsonStr) {
    const key = djb2(jsonStr);
    if (processed.has(key)) return;
    processed.add(key);
    if (processed.size > 500) processed.delete(processed.keys().next().value);

    let spec;
    try {
      spec = JSON.parse(jsonStr);
    } catch {
      addLog("⚠️ Action ARENAFS ignorée : JSON invalide.", "warn");
      return;
    }

    const action = String(spec.action || "").toLowerCase();
    if (!VALID_ACTIONS.includes(action)) {
      addLog(`⚠️ Action inconnue : « ${spec.action} »`, "warn");
      return;
    }

    const msg = { op: action, path: spec.path };
    if (action === "write") {
      msg.content = spec.content ?? "";
      msg.encoding = spec.encoding === "base64" ? "base64" : "text";
    }
    if (action === "read") {
      msg.encoding = spec.encoding === "base64" ? "base64" : "text";
    }
    if (action === "remove") {
      msg.recursive = spec.recursive !== false;
    }

    addLog(`⚙️ ${action.toUpperCase()} ${spec.path ?? ""}`, "info");
    const resp = await sendBg(msg);

    const payload = resp.ok
      ? { ok: true, action, path: spec.path, ...(resp.result || {}) }
      : { ok: false, action, path: spec.path, error: resp.error };

    if (typeof payload.content === "string" && payload.content.length > MAX_CONTENT_INSERT) {
      payload.content = payload.content.slice(0, MAX_CONTENT_INSERT);
      payload.truncated = true;
    }
    if (typeof payload.base64 === "string" && payload.base64.length > MAX_CONTENT_INSERT) {
      payload.base64 = payload.base64.slice(0, MAX_CONTENT_INSERT);
      payload.truncated = true;
    }

    if (resp.ok) {
      addLog(
        `✅ ${action} ${spec.path ?? ""}${payload.bytes != null ? ` (${payload.bytes} octets écrits)` : ""}`,
        "ok"
      );
    } else {
      addLog(`❌ ${action} ${spec.path ?? ""} → ${resp.error}`, "err");
    }

    const line = "ARENAFS_RESULT: " + JSON.stringify(payload);
    state.lastResult = line;
    if (state.autoInsert) {
      const inserted = insertIntoComposer(line);
      if (!inserted) {
        addLog("ℹ️ Résultat non inséré : champ de saisie introuvable (bouton « Insérer » dispo).", "warn");
      }
    }
  }

  function scanNow() {
    if (!state.autoExec || !document.body) return;
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      if (!text || !text.includes(ACTION_MARKER)) continue;
      // Ne pas exécuter ce qui est en train d'être tapé dans le champ de saisie.
      if (
        node.parentElement &&
        node.parentElement.closest(
          '[contenteditable="true"], [contenteditable="plaintext-only"], textarea'
        )
      ) {
        continue;
      }
      for (const rawLine of text.split("\n")) {
        const m = rawLine.match(ACTION_RE);
        if (m) found.push(m[1]);
      }
    }
    // Limite de sécurité : pas plus de 10 actions d'un coup.
    for (const jsonStr of found.slice(0, 10)) {
      void executeAction(jsonStr);
    }
  }

  let scanTimer = null;
  function scheduleScan(delay = 500) {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanNow();
    }, delay);
  }

  function startObserver() {
    const obs = new MutationObserver(() => scheduleScan());
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    // Filet de sécurité au cas où des mutations nous échappent.
    setInterval(() => scheduleScan(50), 2500);
    scheduleScan(50);
  }

  /* ---------------- panneau (journal + statut) ---------------- */

  let panelHost = null;
  let shadow = null;
  let logEl = null;
  let dotEl = null;
  let pillLabelEl = null;

  function addLog(text, cls = "info") {
    if (!logEl) return;
    const line = document.createElement("div");
    line.className = "line " + cls;
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    line.textContent = `[${time}] ${text}`;
    logEl.appendChild(line);
    while (logEl.childElementCount > 100) logEl.firstElementChild.remove();
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function refreshStatus() {
    if (!dotEl || !pillLabelEl) return;
    const resp = await sendBg({ op: "status" });
    const ok = resp && resp.ok && resp.result && resp.result.connected;
    dotEl.classList.toggle("on", !!ok && resp.result.permission === "granted");
    dotEl.classList.toggle("warn", !ok || resp.result.permission !== "granted");
    pillLabelEl.textContent = ok
      ? `Arena FS : « ${resp.result.name} » connecté`
      : "Arena FS : aucun dossier — cliquez sur l'icône de l'extension";
  }

  function syncCheckboxes() {
    if (!shadow) return;
    const chkExec = shadow.getElementById("chk-exec");
    const chkInsert = shadow.getElementById("chk-insert");
    if (chkExec) chkExec.checked = state.autoExec;
    if (chkInsert) chkInsert.checked = state.autoInsert;
  }

  function mountPanel() {
    if (panelHost || !document.body || state.panelHidden) return;
    panelHost = document.createElement("div");
    panelHost.id = "arena-fs-panel-host";
    shadow = panelHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        #pill {
          position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
          display: flex; align-items: center; gap: 8px;
          background: #111827; color: #e5e7eb;
          font: 12px/1.4 system-ui, -apple-system, sans-serif;
          padding: 7px 10px; border-radius: 999px; border: 1px solid #374151;
          box-shadow: 0 4px 14px rgba(0,0,0,.35); cursor: pointer; user-select: none;
          max-width: 420px;
        }
        #dot { width: 9px; height: 9px; border-radius: 50%; background: #6b7280; flex: none; }
        #dot.on { background: #22c55e; }
        #dot.warn { background: #f59e0b; }
        #pill-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #close { background: none; border: none; color: #9ca3af; cursor: pointer; font-size: 12px; padding: 0 2px; }
        #close:hover { color: #fff; }
        #panel {
          position: fixed; right: 16px; bottom: 52px; z-index: 2147483647;
          width: 360px; max-width: calc(100vw - 32px);
          background: #111827; color: #e5e7eb; border: 1px solid #374151;
          border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.45);
          font: 12px/1.5 system-ui, -apple-system, sans-serif; padding: 10px;
        }
        #panel label { display: flex; gap: 6px; align-items: flex-start; margin: 4px 0; cursor: pointer; }
        #log {
          margin: 8px 0; padding: 6px; background: #0b1220; border: 1px solid #1f2937;
          border-radius: 6px; height: 140px; overflow-y: auto; font-family: ui-monospace, monospace; font-size: 11px;
        }
        .line { margin: 1px 0; overflow-wrap: anywhere; }
        .line.ok { color: #86efac; } .line.err { color: #fca5a5; }
        .line.warn { color: #fcd34d; } .line.info { color: #cbd5e1; }
        .buttons { display: flex; gap: 6px; }
        .buttons button {
          flex: 1; background: #1f2937; color: #e5e7eb; border: 1px solid #374151;
          border-radius: 6px; padding: 5px 6px; cursor: pointer; font-size: 11px;
        }
        .buttons button:hover { background: #374151; }
      </style>
      <div id="pill" title="Arena FS — pont de fichiers local (cliquer pour le journal)">
        <span id="dot"></span>
        <span id="pill-label">Arena FS…</span>
        <button id="close" title="Masquer le panneau">✕</button>
      </div>
      <div id="panel" hidden>
        <label><input type="checkbox" id="chk-exec"> Exécuter automatiquement les actions de l'IA, sans confirmation</label>
        <label><input type="checkbox" id="chk-insert"> Insérer automatiquement les résultats dans le champ du chat</label>
        <div id="log"></div>
        <div class="buttons">
          <button id="btn-copy" title="Copier le dernier ARENAFS_RESULT">Copier résultat</button>
          <button id="btn-insert" title="Insérer le dernier résultat dans le chat">Insérer dans le chat</button>
          <button id="btn-clear">Vider journal</button>
        </div>
      </div>
    `;
    document.body.appendChild(panelHost);

    dotEl = shadow.getElementById("dot");
    pillLabelEl = shadow.getElementById("pill-label");
    logEl = shadow.getElementById("log");
    const panel = shadow.getElementById("panel");

    shadow.getElementById("pill").addEventListener("click", (e) => {
      if (e.target && e.target.id === "close") return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) refreshStatus();
    });
    shadow.getElementById("close").addEventListener("click", async () => {
      await chrome.storage.local.set({ arenaFsPanelHidden: true });
    });
    shadow.getElementById("chk-exec").addEventListener("change", (e) => {
      chrome.storage.local.set({ arenaFsAutoExec: e.target.checked });
    });
    shadow.getElementById("chk-insert").addEventListener("change", (e) => {
      chrome.storage.local.set({ arenaFsAutoInsert: e.target.checked });
    });
    shadow.getElementById("btn-copy").addEventListener("click", async () => {
      if (state.lastResult) {
        await navigator.clipboard.writeText(state.lastResult).catch(() => {});
        addLog("📋 Dernier résultat copié.", "info");
      }
    });
    shadow.getElementById("btn-insert").addEventListener("click", () => {
      if (state.lastResult) insertIntoComposer(state.lastResult);
    });
    shadow.getElementById("btn-clear").addEventListener("click", () => {
      logEl.textContent = "";
    });

    syncCheckboxes();
    refreshStatus();
  }

  /* ---------------- initialisation ---------------- */

  async function init() {
    const stored = await chrome.storage.local.get([
      "arenaFsAutoExec",
      "arenaFsAutoInsert",
      "arenaFsPanelHidden",
    ]);
    state.autoExec = stored.arenaFsAutoExec !== false;
    state.autoInsert = stored.arenaFsAutoInsert !== false;
    state.panelHidden = stored.arenaFsPanelHidden === true;

    if (document.body) {
      mountPanel();
      startObserver();
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        mountPanel();
        startObserver();
      });
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.arenaFsAutoExec) {
        state.autoExec = changes.arenaFsAutoExec.newValue !== false;
        syncCheckboxes();
      }
      if (changes.arenaFsAutoInsert) {
        state.autoInsert = changes.arenaFsAutoInsert.newValue !== false;
        syncCheckboxes();
      }
      if (changes.arenaFsPanelHidden) {
        state.panelHidden = changes.arenaFsPanelHidden.newValue === true;
        if (state.panelHidden) {
          if (panelHost) {
            panelHost.remove();
            panelHost = null;
            shadow = null;
            logEl = dotEl = pillLabelEl = null;
          }
        } else {
          mountPanel();
        }
      }
      if (changes.rootName) refreshStatus();
    });

    window.addEventListener("focus", () => refreshStatus());
  }

  void init();
})();
