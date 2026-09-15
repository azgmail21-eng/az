(function () {
  if (document.getElementById("dfb-panel")) return; // évite double injection

  const panel = document.createElement("div");
  panel.id = "dfb-panel";
  panel.innerHTML = `
    <div id="dfb-header">
      📁 File Bridge
      <button id="dfb-toggle" title="Réduire / agrandir">—</button>
    </div>
    <div id="dfb-body">
      <div class="dfb-row">
        <button data-action="list">Lister</button>
        <button data-action="read">Lire</button>
        <button data-action="write">Écrire</button>
      </div>
      <div class="dfb-row">
        <button data-action="mkdir">Créer dossier</button>
      </div>
      <textarea id="dfb-output" readonly placeholder="Le résultat apparaîtra ici..."></textarea>
      <div class="dfb-row">
        <button id="dfb-copy">Copier le résultat</button>
        <button id="dfb-insert">Insérer dans le chat</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const output = panel.querySelector("#dfb-output");
  const body = panel.querySelector("#dfb-body");

  panel.querySelector("#dfb-toggle").addEventListener("click", () => {
    body.style.display = body.style.display === "none" ? "block" : "none";
  });

  function callHost(action, extra = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "fb-request", payload: { action, ...extra } },
        (response) => resolve(response)
      );
    });
  }

  panel.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      let payload = {};

      if (action === "list") {
        const p = prompt("Dossier à lister (ex: C:\\Users\\remi\\Documents) :", "");
        if (p === null) return;
        payload.path = p;
      } else if (action === "read") {
        const p = prompt("Chemin complet du fichier à lire (ex: C:\\Users\\remi\\Documents\\a.txt) :", "");
        if (!p) return;
        payload.path = p;
      } else if (action === "write") {
        const p = prompt("Chemin complet du fichier à écrire :", "");
        if (!p) return;
        const content = prompt("Contenu à écrire dans le fichier :", "");
        if (content === null) return;
        if (!confirm(`Confirmer l'écriture dans :\n${p}\n\n(écrase le fichier s'il existe déjà)`)) return;
        payload.path = p;
        payload.content = content;
      } else if (action === "mkdir") {
        const p = prompt("Chemin complet du dossier à créer :", "");
        if (!p) return;
        payload.path = p;
      }

      output.value = "⏳ En cours...";
      const res = await callHost(action, payload);

      if (!res) {
        output.value = "❌ Aucune réponse (extension ou host indisponible).";
      } else if (res.ok === false) {
        output.value = `❌ Erreur: ${res.error}`;
      } else if (action === "list") {
        output.value =
          `Dossier: ${res.dir}\n\n` +
          res.entries.map((e) => `${e.type === "dir" ? "[DIR] " : "      "}${e.name}`).join("\n");
      } else if (action === "read") {
        output.value = res.content;
      } else if (action === "write") {
        output.value = `✅ Écrit (${res.bytesWritten} octets) : ${res.path}`;
      } else if (action === "mkdir") {
        output.value = `✅ Dossier créé : ${res.path}`;
      }
    });
  });

  panel.querySelector("#dfb-copy").addEventListener("click", () => {
    navigator.clipboard.writeText(output.value);
  });

  panel.querySelector("#dfb-insert").addEventListener("click", () => {
    const textarea = document.querySelector("textarea");
    if (!textarea) {
      alert("Zone de texte du chat introuvable sur cette page.");
      return;
    }
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    ).set;
    nativeSetter.call(textarea, textarea.value + output.value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
  });

  // ---- Détection automatique des actions demandées par DeepSeek dans ses réponses ----
  // Tout doit être dans un bloc de code (```filebridge ... ```). Aucun JSON nulle
  // part : les chemins Windows contiennent souvent des lettres qui, précédées
  // d'un antislash, ressemblent à des séquences d'échappement JSON (\r, \n, \t,
  // \b, \u) et cassent le parsing de façon imprévisible (ex: "remi" commence
  // par r → \r devient un retour chariot). On utilise donc un format texte
  // brut ligne par ligne, sans aucune règle d'échappement.
  //
  //  - Action simple (read/list/mkdir) :
  //      ```filebridge
  //      ACTION: read
  //      PATH: C:\Users\remi\Documents\fichier.txt
  //      ```
  //
  //  - Écriture de fichier :
  //      ```filebridge
  //      WRITE_PATH: C:\Users\remi\Documents\dossier\fichier.py
  //      ---
  //      <contenu exact du fichier ici>
  //      ```
  const processed = new WeakSet();
  const processedText = new Set();

  function alreadyProcessed(node, text) {
    if (processed.has(node)) return true;
    if (processedText.has(text)) return true;
    processed.add(node);
    processedText.add(text);
    return false;
  }

  function insertResultIntoChat(text) {
    const textarea = document.querySelector("textarea");
    if (!textarea) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    ).set;
    nativeSetter.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
  }

  async function scanForActions() {
    // On scanne uniquement les blocs de code <pre> (le rendu Markdown y préserve
    // tout tel quel : indentation, antislashs, guillemets...).
    const codeBlocks = document.querySelectorAll("pre");

    for (const pre of codeBlocks) {
      const raw = pre.textContent || "";
      const trimmed = raw.trim();
      if (!trimmed.startsWith("ACTION:") && !trimmed.startsWith("WRITE_PATH:")) continue;
      if (alreadyProcessed(pre, trimmed)) continue;

      // ---- Écriture de fichier ----
      if (trimmed.startsWith("WRITE_PATH:")) {
        const firstNewline = raw.indexOf("\n");
        const filePath = raw.slice("WRITE_PATH:".length, firstNewline).trim();
        const rest = raw.slice(firstNewline + 1);
        const sepIndex = rest.indexOf("---\n");
        if (sepIndex === -1) {
          output.value = `❌ Bloc WRITE_PATH sans séparateur "---" trouvé, ignoré.`;
          continue;
        }
        let content = rest.slice(sepIndex + 4);
        content = content.replace(/\n$/, ""); // retire un éventuel retour à la ligne final ajouté par le rendu

        const ok = confirm(`DeepSeek demande à écrire dans :\n${filePath}\n\nAutoriser ?`);
        if (!ok) {
          insertResultIntoChat(`Résultat de l'action fichier : écriture refusée par l'utilisateur.`);
          continue;
        }

        output.value = `⏳ Exécution automatique : write ${filePath}`;
        const res = await callHost("write", { path: filePath, content });
        output.value = JSON.stringify(res, null, 2);

        const summary =
          !res || res.ok === false
            ? `Résultat de l'action fichier (write) : ERREUR - ${res ? res.error : "pas de réponse"}`
            : `Résultat de l'action fichier (write ${res.path}) : OK, ${res.bytesWritten} octets écrits.`;
        insertResultIntoChat(summary);
        continue;
      }

      // ---- Action simple (read/list/mkdir) : format "ACTION: xxx" / "PATH: xxx" ----
      const lines = trimmed.split("\n");
      const actionLine = lines[0] || "";
      const pathLine = lines.find((l) => l.trim().toUpperCase().startsWith("PATH:")) || "";

      const action = actionLine.slice("ACTION:".length).trim().toLowerCase();
      const filePath = pathLine.slice(pathLine.toUpperCase().indexOf("PATH:") + "PATH:".length).trim();

      if (!action || !filePath) {
        output.value = `❌ Bloc ACTION incomplet (il faut une ligne ACTION: et une ligne PATH:), ignoré :\n${trimmed}`;
        continue;
      }
      if (!["read", "list", "mkdir"].includes(action)) {
        output.value = `❌ Action inconnue "${action}" (seules read, list, mkdir, et WRITE_PATH existent).`;
        continue;
      }

      output.value = `⏳ Exécution automatique : ${action} ${filePath}`;
      const res = await callHost(action, { path: filePath });
      output.value = JSON.stringify(res, null, 2);

      let summary;
      if (!res || res.ok === false) {
        summary = `Résultat de l'action fichier (${action}) : ERREUR - ${
          res ? res.error : "pas de réponse"
        }`;
      } else if (action === "list") {
        summary =
          `Résultat de l'action fichier (list ${res.dir}) :\n` +
          res.entries.map((e) => `${e.type === "dir" ? "[DIR] " : ""}${e.name}`).join("\n");
      } else if (action === "read") {
        summary = `Résultat de l'action fichier (read ${res.path}) :\n${res.content}`;
      } else if (action === "mkdir") {
        summary = `Résultat de l'action fichier (mkdir ${res.path}) : OK, dossier créé.`;
      }

      insertResultIntoChat(summary);
    }
  }

  const observer = new MutationObserver(() => {
    clearTimeout(window.__dfbScanTimer);
    window.__dfbScanTimer = setTimeout(scanForActions, 800);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // Scan immédiat au chargement, pour les blocs déjà présents sur la page
  // (ex: en rouvrant une conversation existante, sans nouvelle mutation du DOM).
  scanForActions();
})();