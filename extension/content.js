(() => {
  if (!location.pathname.startsWith("/agent")) return;
  if (document.getElementById("adb-panel")) return;

  const AGENT_INSTRUCTIONS = [
    "Tu disposes de l'outil local Arena Documents Bridge. Il permet de lire, lister et créer des fichiers uniquement dans le dossier Documents de l'utilisateur.",
    "Quand une action sur un fichier est nécessaire, réponds avec UN SEUL bloc de code dont le langage est filebridge, puis attends le résultat qui sera automatiquement renvoyé dans la conversation.",
    "Les chemins sont relatifs à Documents et utilisent des slashs. N'utilise jamais de chemin absolu, de lecteur Windows, ni de '..'. Le chemin '.' désigne la racine Documents.",
    "Lister :",
    "```filebridge",
    "ACTION: list",
    "PATH: .",
    "```",
    "Lire :",
    "```filebridge",
    "ACTION: read",
    "PATH: MonProjet/README.md",
    "```",
    "Créer un dossier :",
    "```filebridge",
    "ACTION: mkdir",
    "PATH: MonProjet/src",
    "```",
    "Créer ou remplacer un fichier : mets une ligne contenant uniquement --- après PATH, puis le contenu exact du fichier.",
    "```filebridge",
    "ACTION: write",
    "PATH: MonProjet/src/main.py",
    "---",
    'print("Bonjour")',
    "```",
    "Une seule action par réponse. Pour écrire du code, place tout le code dans le contenu après ---. Les actions sont automatiques et ne demandent pas de confirmation.",
  ].join("\n");

  const panel = document.createElement("aside");
  panel.id = "adb-panel";
  panel.innerHTML = `
    <div id="adb-header">
      <div class="adb-heading">
        <strong>📁 Arena · Documents</strong>
        <span id="adb-status" role="status">Pont local non vérifié</span>
      </div>
      <div class="adb-header-buttons">
        <button id="adb-pause" type="button" aria-pressed="false" title="Suspendre les actions automatiques">Pause</button>
        <button id="adb-toggle" type="button" aria-expanded="true" title="Réduire le panneau">−</button>
      </div>
    </div>
    <div id="adb-body">
      <div class="adb-notice">Mode automatique, sans confirmation par action. L'accès est limité au dossier Windows <strong>Documents</strong>.</div>
      <div class="adb-row">
        <button id="adb-test" type="button">Tester le pont</button>
        <button id="adb-copy-instructions" type="button">Copier les instructions IA</button>
      </div>
      <div class="adb-row">
        <button data-action="list" type="button">Lister</button>
        <button data-action="read" type="button">Lire</button>
        <button data-action="write" type="button">Créer / écrire</button>
      </div>
      <div class="adb-row adb-row-single">
        <button data-action="mkdir" type="button">Créer un dossier</button>
      </div>
      <textarea id="adb-output" readonly aria-label="Résultat du pont de fichiers" placeholder="Les actions et leurs résultats apparaîtront ici…"></textarea>
      <div class="adb-footnote">Les fichiers existants peuvent être remplacés. Aucune suppression de fichier n'est prise en charge.</div>
    </div>
  `;
  document.body.appendChild(panel);

  const output = panel.querySelector("#adb-output");
  const status = panel.querySelector("#adb-status");
  const body = panel.querySelector("#adb-body");
  const processedResponses = new WeakSet();
  let paused = false;
  let actionInProgress = false;

  const setStatus = (message, state = "neutral") => {
    status.textContent = message;
    status.dataset.state = state;
  };

  function callHost(action, extra = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "arena-documents-request", payload: { action, ...extra } },
        (response) => {
          const runtimeError = chrome.runtime.lastError;
          resolve(
            response || {
              ok: false,
              error: runtimeError?.message || "Aucune réponse du Native Host.",
            }
          );
        }
      );
    });
  }

  function formatActionResult(action, response) {
    if (!response || response.ok === false) {
      return `Résultat Arena Documents Bridge (${action}) : ERREUR — ${response?.error || "aucune réponse"}`;
    }

    if (action === "read") {
      return `Résultat Arena Documents Bridge (lecture de ${response.path}) :\n${response.content}`;
    }
    if (action === "list") {
      const items = (response.entries || []).map((entry) => {
        const prefix = entry.type === "dir" ? "[DOSSIER] " : entry.type === "link" ? "[LIEN REFUSÉ] " : "[FICHIER] ";
        return `${prefix}${entry.name}`;
      });
      if (response.truncated) items.push("… liste tronquée à 500 éléments");
      return `Résultat Arena Documents Bridge (contenu de ${response.path}) :\n${items.join("\n") || "(vide)"}`;
    }
    if (action === "mkdir") {
      return `Résultat Arena Documents Bridge : dossier créé ou déjà présent — ${response.path}`;
    }
    if (action === "write") {
      return `Résultat Arena Documents Bridge : fichier créé ou remplacé — ${response.path} (${response.bytesWritten} octets).`;
    }
    return `Résultat Arena Documents Bridge : ${JSON.stringify(response)}`;
  }

  function renderResponse(response) {
    output.value = JSON.stringify(response, null, 2);
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
  }

  function findComposer() {
    const candidates = [...document.querySelectorAll(
      'textarea:not([readonly]):not([disabled]), input:not([type="search"]):not([type="hidden"]):not([disabled]), [contenteditable="true"], [role="textbox"]'
    )].filter((element) => !panel.contains(element) && isVisible(element));

    candidates.sort((left, right) => {
      const score = (element) => {
        const rect = element.getBoundingClientRect();
        const hint = [
          element.getAttribute("placeholder"),
          element.getAttribute("aria-label"),
          element.getAttribute("data-testid"),
        ].join(" ").toLowerCase();
        const promptHint = /message|prompt|ask|chat|send|envoyer|agent/.test(hint) ? 100000 : 0;
        const mainHint = element.closest("main") ? 10000 : 0;
        return promptHint + mainHint + rect.bottom * 10 + rect.width;
      };
      return score(right) - score(left);
    });

    return candidates[0] || null;
  }

  function setComposerText(composer, text) {
    composer.focus();
    if (composer.isContentEditable || (!/^(TEXTAREA|INPUT)$/.test(composer.tagName))) {
      composer.textContent = text;
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return;
    }

    const prototype = composer instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(composer, text);
    else composer.value = text;
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findSubmitButton(composer) {
    const form = composer.closest("form");
    const buttons = [...(form || document).querySelectorAll("button")]
      .filter((button) => !panel.contains(button) && isVisible(button) && !button.disabled);

    const score = (button) => {
      const label = [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.getAttribute("data-testid"),
        button.textContent,
      ].join(" ").toLowerCase();
      if (/stop|cancel|arrêter|annuler/.test(label)) return -1;
      if (/send|submit|envoyer|transmettre/.test(label)) return 100;
      if (button.type === "submit") return 80;
      return 0;
    };

    return buttons.map((button) => ({ button, score: score(button) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.button || null;
  }

  async function returnResultToAgent(text) {
    const composer = findComposer();
    if (!composer) {
      setStatus("Action faite · résultat prêt à copier", "warning");
      output.value = `${output.value}\n\n${text}`;
      return false;
    }

    setComposerText(composer, text);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const sendButton = findSubmitButton(composer);
    if (sendButton) {
      sendButton.click();
      setStatus("Résultat renvoyé à Agent Mode", "success");
      return true;
    }

    const form = composer.closest("form");
    if (form && typeof form.requestSubmit === "function") {
      form.requestSubmit();
      setStatus("Résultat renvoyé à Agent Mode", "success");
      return true;
    }

    setStatus("Résultat prêt · clique sur Envoyer", "warning");
    return false;
  }

  panel.querySelector("#adb-toggle").addEventListener("click", (event) => {
    const collapsed = body.hidden;
    body.hidden = !collapsed;
    event.currentTarget.textContent = collapsed ? "−" : "+";
    event.currentTarget.setAttribute("aria-expanded", String(collapsed));
    event.currentTarget.title = collapsed ? "Réduire le panneau" : "Agrandir le panneau";
  });

  panel.querySelector("#adb-pause").addEventListener("click", (event) => {
    paused = !paused;
    event.currentTarget.textContent = paused ? "Reprendre" : "Pause";
    event.currentTarget.setAttribute("aria-pressed", String(paused));
    setStatus(paused ? "Actions automatiques suspendues" : "Actions automatiques actives", paused ? "warning" : "success");
  });

  panel.querySelector("#adb-test").addEventListener("click", async () => {
    setStatus("Vérification du Native Host…", "neutral");
    const response = await callHost("ping");
    renderResponse(response);
    if (response?.ok) setStatus("Pont local connecté · Documents", "success");
    else setStatus("Pont local indisponible", "error");
  });

  panel.querySelector("#adb-copy-instructions").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(AGENT_INSTRUCTIONS);
      setStatus("Instructions copiées · colle-les dans Agent Mode", "success");
    } catch (error) {
      output.value = `Impossible de copier automatiquement.\n\n${AGENT_INSTRUCTIONS}\n\n${error?.message || ""}`;
      setStatus("Instructions affichées dans le résultat", "warning");
    }
  });

  panel.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      const prompts = {
        list: ["Dossier relatif à Documents à lister (ex. MonProjet ou .) :", "."],
        read: ["Fichier relatif à Documents à lire (ex. MonProjet/README.md) :", ""],
        write: ["Fichier relatif à Documents à créer ou remplacer :", ""],
        mkdir: ["Dossier relatif à Documents à créer :", ""],
      };
      const [question, initialValue] = prompts[action];
      const relativePath = prompt(question, initialValue);
      if (relativePath === null || (action !== "list" && !relativePath)) return;

      const extra = { path: relativePath };
      if (action === "write") {
        const content = prompt("Contenu texte du fichier (un fichier existant sera remplacé) :", "");
        if (content === null) return;
        extra.content = content;
      }

      output.value = "⏳ Opération en cours…";
      const response = await callHost(action, extra);
      renderResponse(response);
      if (response?.ok) setStatus(`Opération ${action} terminée · Documents`, "success");
      else setStatus(`Échec de l'opération ${action}`, "error");
    });
  });

  function hasFileBridgeLanguage(pre) {
    const code = pre.querySelector("code");
    if (!code) return false;
    const className = typeof code.className === "string" ? code.className : "";
    return /(?:^|\s)language-filebridge(?:\s|$)/i.test(className) ||
      code.getAttribute("data-language")?.toLowerCase() === "filebridge";
  }

  function locateResponse(pre) {
    let node = pre;
    let fallback = null;
    const maxDepth = 14;

    for (let depth = 0; node && node !== document.body && depth < maxDepth; depth += 1, node = node.parentElement) {
      const labels = [
        node.getAttribute("data-message-author-role"),
        node.getAttribute("data-message-role"),
        node.getAttribute("data-role"),
        node.getAttribute("data-author"),
        node.getAttribute("data-testid"),
        node.getAttribute("aria-label"),
        typeof node.className === "string" ? node.className : "",
      ].filter(Boolean).join(" ").toLowerCase();

      if (/\b(user|human|utilisateur)\b/.test(labels)) {
        return { isAssistant: false, container: node };
      }
      if (/\b(assistant|agent|model|bot)\b/.test(labels)) {
        return { isAssistant: true, container: node };
      }
      if (!fallback && (
        node.tagName === "ARTICLE" ||
        node.hasAttribute("data-message-id") ||
        /message|response|turn/i.test(node.getAttribute("data-testid") || "")
      )) {
        fallback = node;
      }
    }

    // La page est déjà limitée à arena.ai/agent et les commandes doivent en plus
    // être dans un bloc de code explicitement étiqueté filebridge.
    return { isAssistant: true, container: fallback || pre };
  }

  function markExistingCommands() {
    // N'exécute jamais à l'ouverture les commandes d'une ancienne conversation.
    document.querySelectorAll("pre").forEach((pre) => {
      if (!hasFileBridgeLanguage(pre)) return;
      const response = locateResponse(pre);
      if (response.isAssistant) processedResponses.add(response.container);
    });
  }

  function parseActionBlock(raw) {
    let text = raw.replace(/\r\n?/g, "\n");
    // Le renderer Markdown ajoute souvent un dernier LF avant la fermeture du bloc.
    if (text.endsWith("\n")) text = text.slice(0, -1);
    const lines = text.split("\n");

    const actionMatch = lines[0]?.trim().match(/^ACTION\s*:\s*(\S+)\s*$/i);
    if (!actionMatch) return { error: "La première ligne doit être ACTION: list, read, mkdir ou write." };
    const action = actionMatch[1].toLowerCase();
    if (!["list", "read", "mkdir", "write"].includes(action)) {
      return { error: `Action inconnue : ${action}. Actions possibles : list, read, mkdir, write.` };
    }

    const separatorIndex = action === "write" ? lines.findIndex((line, index) => index > 0 && line.trim() === "---") : -1;
    const headerEnd = separatorIndex === -1 ? lines.length : separatorIndex;
    const pathLine = lines.slice(1, headerEnd).find((line) => /^PATH\s*:/i.test(line.trim()));
    const relativePath = pathLine ? pathLine.trim().replace(/^PATH\s*:/i, "").trim() : "";
    if (!relativePath) return { error: "Chemin manquant : ajoute une ligne PATH: relative à Documents." };

    if (action === "write") {
      if (separatorIndex === -1) return { error: 'Séparateur manquant : ajoute une ligne contenant uniquement "---" avant le contenu.' };
      const content = lines.slice(separatorIndex + 1).join("\n");
      return { action, path: relativePath, content };
    }
    return { action, path: relativePath };
  }

  function isAssistantGenerating() {
    const selectors = [
      'button[aria-label*="stop" i]',
      'button[title*="stop" i]',
      'button[data-testid*="stop" i]',
      'button[aria-label*="arrêter" i]',
      '[data-testid*="stop-generating" i]',
    ];
    return selectors.some((selector) => [...document.querySelectorAll(selector)].some((element) =>
      !panel.contains(element) && isVisible(element)
    ));
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function waitForAssistantIdle() {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (!isAssistantGenerating()) return true;
      await wait(500);
    }
    return false;
  }

  async function scanForActions() {
    if (paused || actionInProgress) return;

    for (const pre of document.querySelectorAll("pre")) {
      if (!hasFileBridgeLanguage(pre)) continue;
      const response = locateResponse(pre);
      if (!response.isAssistant || processedResponses.has(response.container)) continue;

      const originalText = pre.textContent || "";
      const isIdle = await waitForAssistantIdle();
      if (!isIdle || paused || !pre.isConnected) return;
      // Laisse aussi passer un court délai calme pour les interfaces sans bouton Stop détectable.
      await wait(350);
      if (!pre.isConnected || originalText !== (pre.textContent || "")) return;

      // Recalcule le conteneur au cas où l'interface l'aurait rerendu pendant l'attente.
      const currentResponse = locateResponse(pre);
      if (!currentResponse.isAssistant || processedResponses.has(currentResponse.container)) continue;
      processedResponses.add(currentResponse.container);

      const command = parseActionBlock(pre.textContent || "");
      actionInProgress = true;
      try {
        if (command.error) {
          output.value = `❌ ${command.error}`;
          await returnResultToAgent(`Résultat Arena Documents Bridge : ERREUR — ${command.error}`);
          return;
        }

        setStatus(`Exécution automatique · ${command.action} ${command.path}`, "neutral");
        output.value = `⏳ ${command.action} ${command.path}`;
        const result = await callHost(command.action, {
          path: command.path,
          ...(command.action === "write" ? { content: command.content } : {}),
        });
        renderResponse(result);
        const summary = formatActionResult(command.action, result);
        await returnResultToAgent(summary);
      } catch (error) {
        const detail = error?.message || String(error);
        output.value = `❌ ${detail}`;
        setStatus("Échec de l'action automatique", "error");
      } finally {
        actionInProgress = false;
      }
      return; // une seule commande par réponse de l'agent
    }
  }

  markExistingCommands();
  const observer = new MutationObserver(() => {
    clearTimeout(window.__arenaDocumentsBridgeScanTimer);
    window.__arenaDocumentsBridgeScanTimer = setTimeout(scanForActions, 900);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // Vérifie le pont au chargement, sans effectuer de commande de fichier.
  callHost("ping").then((response) => {
    if (response?.ok) setStatus("Pont connecté · accès Documents", "success");
    else setStatus("Pont non installé · consulte le README", "error");
  });
})();
