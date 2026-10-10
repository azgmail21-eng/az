/* Arena Saver — panneau flottant + sauvegarde dans un dossier local (Edge/Chrome).
 * Repose sur detect.js (window.ArenaDetect) et JSZip (window.JSZip) chargés avant. */
(function () {
  'use strict';
  if (window.__arsInjected) return;
  window.__arsInjected = true;

  var D = window.ArenaDetect;
  if (!D) return;

  var FS_OK = typeof window.showDirectoryPicker === 'function';
  var state = {
    artifacts: [],       // [{...artifact, checked, customName}]
    dirName: '',
    collapsed: false,
    busy: false
  };
  var dirHandle = null;

  // ---------- Mini IndexedDB : mémorise le dossier choisi ----------

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open('ars-db', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
  }

  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('kv', 'readonly');
          var rq = tx.objectStore('kv').get(key);
          rq.onsuccess = function () { resolve(rq.result || null); };
          rq.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }

  function idbSet(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(value, key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }

  // ---------- Toast ----------

  var toastTimer = null;
  function toast(msg, ms) {
    var el = document.getElementById('ars-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ars-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.display = 'none'; }, ms || 3500);
  }

  // ---------- Dossier de destination ----------

  function refreshFolderUI() {
    var label = document.getElementById('ars-folder-name');
    if (label) {
      label.textContent = dirHandle ? ('📁 ' + (state.dirName || dirHandle.name)) : '📁 Aucun dossier choisi';
      label.title = dirHandle ? 'Les fichiers seront écrits dans ce dossier' : 'Clique sur « Choisir… » puis sélectionne ton dossier Documents';
    }
  }

  async function loadHandle() {
    dirHandle = await idbGet('dir');
    if (dirHandle) {
      state.dirName = dirHandle.name || '';
      try {
        var q = await dirHandle.queryPermission({ mode: 'readwrite' });
        if (q !== 'granted') state.dirName += ' (autorisation à renouveler)';
      } catch (e) { /* ancien handle invalide */ dirHandle = null; state.dirName = ''; }
    }
    refreshFolderUI();
  }

  async function ensurePermission() {
    if (!dirHandle) return false;
    try {
      if ((await dirHandle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
      return (await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted';
    } catch (e) {
      return false;
    }
  }

  async function pickFolder() {
    if (!FS_OK) {
      toast('⚠️ Ton navigateur ne permet pas l’écriture directe : utilise le bouton ZIP.', 5000);
      return false;
    }
    try {
      var h = await window.showDirectoryPicker({ mode: 'readwrite' });
      dirHandle = h;
      state.dirName = h.name || '';
      await idbSet('dir', h);
      refreshFolderUI();
      toast('✅ Dossier enregistré : ' + state.dirName);
      return true;
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('❌ Impossible d’ouvrir le dossier : ' + e.message);
      return false;
    }
  }

  // ---------- Écriture ----------

  async function writeToDir(relPath, content) {
    var parts = String(relPath).split('/');
    var dir = dirHandle;
    for (var i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create: true });
    }
    var fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    var w = await fh.createWritable();
    await w.write(content);
    await w.close();
  }

  async function fetchLinkContent(url) {
    var res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.blob();
  }

  function selectedRows() {
    return state.artifacts.filter(function (a) { return a.checked; });
  }

  function rowFilename(a) {
    return D.sanitizeRelPath(a.customName || a.filename);
  }

  function setBusy(b, label) {
    state.busy = b;
    var btns = document.querySelectorAll('#ars-panel button');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = b;
    var status = document.getElementById('ars-status');
    if (status && b && label) {
      status.textContent = label;
      status.style.display = 'block';
    } else if (status && !b) {
      status.style.display = 'none';
    }
  }

  async function saveRows(rows) {
    if (!rows.length) { toast('Rien à sauvegarder (coche au moins un fichier).'); return { ok: 0, ko: 0 }; }
    if (!dirHandle && !(await pickFolder())) return { ok: 0, ko: 0 };
    if (!(await ensurePermission())) {
      toast('⚠️ Autorisation refusée pour ce dossier. Re-clique sur « Choisir… ».', 5000);
      return { ok: 0, ko: 0 };
    }
    // Déduplique les noms finaux (l'utilisateur a pu renommer).
    var tmp = rows.map(function (a) { return { filename: rowFilename(a) }; });
    D.ensureUniqueNames(tmp);
    var ok = 0, ko = 0, errors = [];
    setBusy(true, '⏳ Sauvegarde en cours…');
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i];
      var finalName = tmp[i].filename;
      try {
        if (a.kind === 'link' && /^https?:/i.test(a.url)) {
          await writeToDir(finalName, await fetchLinkContent(a.url));
        } else if (a.kind === 'link') {
          // blob:/data: -> laisse le navigateur gérer via un clic natif.
          if (a.element && a.element.click) a.element.click();
        } else {
          await writeToDir(finalName, a.content);
        }
        ok++;
      } catch (e) {
        ko++;
        errors.push(finalName + ' : ' + (e && e.message ? e.message : e));
      }
      var status = document.getElementById('ars-status');
      if (status) status.textContent = '⏳ Sauvegarde… ' + (i + 1) + '/' + rows.length;
    }
    setBusy(false);
    if (ok && !ko) toast('✅ ' + ok + ' fichier(s) sauvegardé(s) dans « ' + state.dirName + ' »');
    else if (ok && ko) toast('⚠️ ' + ok + ' OK, ' + ko + ' échec(s). Premier échec : ' + errors[0], 6000);
    else toast('❌ Échec : ' + (errors[0] || 'erreur inconnue'), 6000);
    return { ok: ok, ko: ko };
  }

  async function downloadZip(rows) {
    rows = rows || selectedRows();
    if (!rows.length) { toast('Rien à mettre dans le ZIP (coche au moins un fichier).'); return; }
    if (!window.JSZip) { toast('❌ Librairie ZIP introuvable, recharge la page.'); return; }
    setBusy(true, '⏳ Création du ZIP…');
    try {
      var zip = new window.JSZip();
      var tmp = rows.map(function (a) { return { filename: rowFilename(a) }; });
      D.ensureUniqueNames(tmp);
      for (var i = 0; i < rows.length; i++) {
        var a = rows[i];
        if (a.kind === 'link' && /^https?:/i.test(a.url)) {
          zip.file(tmp[i].filename, await fetchLinkContent(a.url));
        } else if (a.kind === 'code') {
          zip.file(tmp[i].filename, a.content);
        }
        var status = document.getElementById('ars-status');
        if (status) status.textContent = '⏳ ZIP… ' + (i + 1) + '/' + rows.length;
      }
      var blob = await zip.generateAsync({ type: 'blob' });
      var d = new Date();
      function p(n) { return (n < 10 ? '0' : '') + n; }
      var name = 'arena-saver-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
        '-' + p(d.getHours()) + p(d.getMinutes()) + '.zip';
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      setTimeout(function () { URL.revokeObjectURL(url); link.remove(); }, 5000);
      toast('✅ ZIP téléchargé : ' + name + ' (' + rows.length + ' fichier(s))');
    } catch (e) {
      toast('❌ Échec ZIP : ' + (e && e.message ? e.message : e), 6000);
    }
    setBusy(false);
  }

  // ---------- Panneau ----------

  function fromBadge(a) {
    if (a.from === 'fallback') return '<span class="ars-badge ars-warn" title="Nom deviné depuis le langage — renomme-le si besoin">✏️</span>';
    if (a.from === 'link') return '<span class="ars-badge" title="Pièce jointe / lien de téléchargement">🔗</span>';
    return '<span class="ars-badge" title="Nom détecté automatiquement">📄</span>';
  }

  function fmtSize(a) {
    if (a.kind === 'link') return 'lien';
    var n = (a.content || '').length;
    if (n < 1024) return n + ' o';
    return (n / 1024).toFixed(1) + ' ko';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function buildPanel() {
    if (document.getElementById('ars-panel')) return;
    var panel = document.createElement('div');
    panel.id = 'ars-panel';
    panel.innerHTML =
      '<div id="ars-header">' +
        '<span>💾 <b>Arena Saver</b> <span id="ars-count">0</span></span>' +
        '<span>' +
          '<button id="ars-toggle" title="Réduire / agrandir">—</button>' +
        '</span>' +
      '</div>' +
      '<div id="ars-body">' +
        '<div class="ars-row" id="ars-folder-row">' +
          '<span id="ars-folder-name">📁 Aucun dossier choisi</span>' +
          '<button id="ars-pick" title="Choisir le dossier de destination (ex: Documents)">Choisir…</button>' +
        '</div>' +
        '<div class="ars-row">' +
          '<button id="ars-save" class="ars-primary">⬇ Tout sauvegarder</button>' +
          '<button id="ars-zip" title="Télécharger la sélection en un seul fichier ZIP">ZIP ⬇</button>' +
          '<button id="ars-rescan" title="Re-détecter les fichiers sur la page">↻</button>' +
        '</div>' +
        '<div id="ars-status" style="display:none"></div>' +
        '<div id="ars-list"></div>' +
        '<div id="ars-hint">💡 Coche les fichiers, renomme-les si besoin, puis « Tout sauvegarder ». Le dossier est mémorisé.</div>' +
      '</div>';
    document.body.appendChild(panel);

    document.getElementById('ars-toggle').addEventListener('click', function () {
      state.collapsed = !state.collapsed;
      document.getElementById('ars-body').style.display = state.collapsed ? 'none' : 'block';
      document.getElementById('ars-toggle').textContent = state.collapsed ? '+' : '—';
    });
    document.getElementById('ars-pick').addEventListener('click', pickFolder);
    document.getElementById('ars-save').addEventListener('click', function () { saveRows(selectedRows()); });
    document.getElementById('ars-zip').addEventListener('click', function () { downloadZip(); });
    document.getElementById('ars-rescan').addEventListener('click', function () { rescan(true); });

    // Délégation pour la liste (cases, renommage, boutons unitaires).
    document.getElementById('ars-list').addEventListener('change', function (ev) {
      var row = ev.target.closest('[data-ars-id]');
      if (!row) return;
      var a = byId(row.getAttribute('data-ars-id'));
      if (!a) return;
      if (ev.target.classList.contains('ars-check')) a.checked = ev.target.checked;
      if (ev.target.classList.contains('ars-name')) a.customName = ev.target.value;
    });
    document.getElementById('ars-list').addEventListener('click', function (ev) {
      var btn = ev.target.closest('.ars-one');
      if (!btn) return;
      var row = btn.closest('[data-ars-id]');
      var a = row && byId(row.getAttribute('data-ars-id'));
      if (a) saveRows([a]);
    });
  }

  function byId(id) {
    for (var i = 0; i < state.artifacts.length; i++) {
      if (state.artifacts[i].id === id) return state.artifacts[i];
    }
    return null;
  }

  function renderList() {
    var list = document.getElementById('ars-list');
    var count = document.getElementById('ars-count');
    if (!list) return;
    if (count) count.textContent = String(state.artifacts.length);
    if (!state.artifacts.length) {
      list.innerHTML = '<div class="ars-empty">Aucun fichier détecté pour l’instant.<br>L’IA n’a pas encore produit de code sur cette page.</div>';
      return;
    }
    list.innerHTML = state.artifacts.map(function (a) {
      return '<div class="ars-item" data-ars-id="' + esc(a.id) + '">' +
        '<input type="checkbox" class="ars-check" ' + (a.checked ? 'checked' : '') + ' title="Inclure dans la sauvegarde">' +
        '<input type="text" class="ars-name" value="' + esc(a.customName || a.filename) + '" spellcheck="false" title="Nom du fichier (modifiable, sous-dossiers autorisés : src/app.py)">' +
        '<span class="ars-meta">' + fromBadge(a) + ' ' + esc(fmtSize(a)) + '</span>' +
        '<button class="ars-one" title="Sauvegarder uniquement ce fichier">💾</button>' +
      '</div>';
    }).join('');
  }

  // ---------- Scan + boutons sur les blocs ----------

  function rescan(manual) {
    var fresh;
    try {
      fresh = D.collectArtifacts(document);
    } catch (e) {
      if (manual) toast('❌ Erreur de détection : ' + e.message);
      return;
    }
    var prev = {};
    state.artifacts.forEach(function (a) { prev[a.id] = a; });
    state.artifacts = fresh.map(function (a) {
      var old = prev[a.id];
      a.checked = old ? old.checked : true;
      a.customName = old ? old.customName : null;
      return a;
    });
    renderList();
    attachBlockButtons();
    if (manual) toast(state.artifacts.length ? ('🔎 ' + state.artifacts.length + ' fichier(s) détecté(s)') : '🔎 Aucun fichier détecté');
  }

  function attachBlockButtons() {
    state.artifacts.forEach(function (a) {
      if (a.kind !== 'code' || !a.element || !a.element.isConnected) return;
      var pre = a.element;
      if (pre.querySelector(':scope > .ars-save-btn')) return;
      try {
        if (window.getComputedStyle(pre).position === 'static') pre.style.position = 'relative';
      } catch (e) { /* ignore */ }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ars-save-btn';
      btn.textContent = '💾';
      btn.title = 'Sauvegarder ce fichier (' + (a.customName || a.filename) + ')';
      btn.setAttribute('data-ars-ignore', '1');
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        saveRows([a]);
      });
      pre.appendChild(btn);
    });
  }

  var scanTimer = null;
  function observe() {
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var t = muts[i].target;
        if (t && t.nodeType === 1 && t.closest && t.closest('#ars-panel,#ars-toast,.ars-save-btn')) continue;
        // Vrai changement de la page -> re-scan différé.
        clearTimeout(scanTimer);
        scanTimer = setTimeout(function () { rescan(false); }, 700);
        return;
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ---------- Messages (popup) ----------

  function serializable() {
    return state.artifacts.map(function (a) {
      return { id: a.id, kind: a.kind, filename: a.customName || a.filename, from: a.from, language: a.language, size: a.size || 0, checked: a.checked };
    });
  }

  if (window.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || !msg.type) return false;
      if (msg.type === 'ars-state') {
        rescan(false);
        sendResponse({ ok: true, count: state.artifacts.length, dirName: state.dirName, hasDir: !!dirHandle, fsOk: FS_OK, files: serializable() });
        return false;
      }
      if (msg.type === 'ars-pick') {
        pickFolder().then(function (ok) { sendResponse({ ok: ok, dirName: state.dirName }); });
        return true;
      }
      if (msg.type === 'ars-save') {
        // Sans dossier mémorisé, le sélecteur exige un clic DANS la page :
        // on replie vers le ZIP automatique pour que le bouton popup marche toujours.
        (async function () {
          if (!dirHandle || !(await ensurePermission())) {
            await downloadZip();
            sendResponse({ ok: true, fallback: 'zip' });
          } else {
            var r = await saveRows(selectedRows());
            sendResponse({ ok: true, saved: r.ok, failed: r.ko });
          }
        })();
        return true;
      }
      if (msg.type === 'ars-zip') {
        downloadZip().then(function () { sendResponse({ ok: true }); });
        return true;
      }
      if (msg.type === 'ars-rescan') {
        rescan(true);
        sendResponse({ ok: true, count: state.artifacts.length });
        return false;
      }
      return false;
    });
  }

  // ---------- Init ----------

  buildPanel();
  refreshFolderUI();
  loadHandle().then(function () { rescan(false); });
  observe();
})();
