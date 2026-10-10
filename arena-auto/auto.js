/* Arena Auto — l'IA pilote le dossier autorisé (Documents) toute seule.
 * Repose sur autofs.js (window.ArenaAutoFS) chargé avant.
 * AUCUNE confirmation par action : la seule autorisation exigée est le choix
 * initial du dossier (imposé par le navigateur, incontournable). */
(function () {
  'use strict';
  if (window.__aaInjected) return;
  window.__aaInjected = true;

  var FS = window.ArenaAutoFS;
  if (!FS) return;

  var FS_OK = typeof window.showDirectoryPicker === 'function';
  var MAX_PER_MIN = 20;      // garde-fou anti-boucle infinie
  var STABLE_MS = 1500;      // un bloc doit être stable 1,5 s avant exécution
  var QUIET_MS = 2500;       // attend la fin du streaming avant de répondre

  var dirHandle = null;
  var dirName = '';
  var enabled = true;
  var needsAuth = false;     // true si l'autorisation d'écriture est perdue
  var log = [];
  var actionTimes = [];
  var lastKey = null, lastCount = 0;

  var seen = new WeakMap();  // pre -> {hash, since, invalidLogged}
  var done = new WeakSet();  // blocs déjà exécutés
  var queue = Promise.resolve();

  // ---------- IndexedDB : mémorise le dossier autorisé ----------

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open('aa-db', 1);
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
          var rq = db.transaction('kv', 'readonly').objectStore('kv').get(key);
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

  // ---------- Utilitaires ----------

  function hash(s) {
    var h = 5381;
    s = String(s);
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function clock(t) {
    var d = new Date(t);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = document.getElementById('aa-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'aa-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.display = 'none'; }, ms || 4000);
  }

  function addLog(label, path, status, detail) {
    log.unshift({ t: Date.now(), label: label, path: path || '', status: status || 'info', detail: detail || '' });
    if (log.length > 40) log.length = 40;
    renderLog();
  }

  // ---------- Dossier autorisé ----------

  async function ensurePermission() {
    if (!dirHandle) return false;
    try {
      if ((await dirHandle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
      // requestPermission sans geste utilisateur récent échoue : on tente quand même.
      return (await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted';
    } catch (e) {
      return false;
    }
  }

  async function pickFolder() {
    if (!FS_OK) {
      toast('⚠️ Ce navigateur ne permet pas l’écriture directe.', 5000);
      return false;
    }
    try {
      var h = await window.showDirectoryPicker({ mode: 'readwrite' });
      dirHandle = h;
      dirName = h.name || '';
      needsAuth = false;
      await idbSet('dir', h);
      addLog('📁 Dossier autorisé', dirName, 'ok', 'sandbox actif : tout reste dans ce dossier');
      renderPanel();
      toast('✅ Dossier autorisé : ' + dirName + ' — l’IA peut y travailler seule.');
      scan();
      return true;
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('❌ ' + e.message);
      return false;
    }
  }

  async function loadHandle() {
    dirHandle = await idbGet('dir');
    if (dirHandle) {
      dirName = dirHandle.name || '';
      try {
        if ((await dirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
          needsAuth = true;
          armClickRenew();
        }
      } catch (e) { dirHandle = null; dirName = ''; }
    }
    renderPanel();
  }

  var renewArmed = false;
  function armClickRenew() {
    if (renewArmed) return;
    renewArmed = true;
    toast('🔑 Autorisation perdue : clique n’importe où sur la page pour ré-autoriser.', 8000);
    document.addEventListener('click', async function onClick() {
      document.removeEventListener('click', onClick);
      renewArmed = false;
      if (await ensurePermission()) {
        needsAuth = false;
        addLog('🔑 Autorisation renouvelée', '', 'ok', '');
        renderPanel();
        scan();
      } else {
        armClickRenew();
      }
    });
  }

  // ---------- Exécution sandboxée ----------

  async function openDir(segs, create) {
    var dir = dirHandle;
    for (var i = 0; i < segs.length; i++) {
      dir = await dir.getDirectoryHandle(segs[i], { create: !!create });
    }
    return dir;
  }

  async function execute(req) {
    var segs = FS.resolveInside(req.path);
    if (!segs) {
      return { ok: false, error: 'chemin refusé par la sandbox (relatif au dossier autorisé uniquement, sans ".." ni chemin absolu)' };
    }
    if (req.type === 'write') {
      var bytes = new Blob([req.content]).size;
      if (bytes > FS.LIMITS.MAX_WRITE) {
        return { ok: false, error: 'fichier trop gros (' + Math.round(bytes / 1024) + ' Ko > ' + FS.LIMITS.MAX_WRITE / 1024 + ' Ko), découpe-le en plusieurs fichiers' };
      }
      if (!segs.length) return { ok: false, error: 'chemin de fichier vide' };
      var dir = await openDir(segs.slice(0, -1), true);
      var fh = await dir.getFileHandle(segs[segs.length - 1], { create: true });
      var w = await fh.createWritable();
      await w.write(req.content);
      await w.close();
      return { ok: true, bytes: bytes };
    }
    if (req.action === 'mkdir') {
      if (!segs.length) return { ok: false, error: 'chemin vide' };
      await openDir(segs, true);
      return { ok: true };
    }
    if (req.action === 'read') {
      if (!segs.length) return { ok: false, error: 'chemin de fichier vide' };
      var rdir = await openDir(segs.slice(0, -1), false);
      var rfh;
      try {
        rfh = await rdir.getFileHandle(segs[segs.length - 1], { create: false });
      } catch (e) {
        return { ok: false, error: 'fichier introuvable : ' + req.path };
      }
      var file = await rfh.getFile();
      var slice = file.size > FS.LIMITS.MAX_READ ? file.slice(0, FS.LIMITS.MAX_READ) : file;
      var content = await slice.text();
      return { ok: true, content: content, truncated: file.size > FS.LIMITS.MAX_READ };
    }
    if (req.action === 'list') {
      var ldir;
      try {
        ldir = await openDir(segs, false);
      } catch (e) {
        return { ok: false, error: 'dossier introuvable : ' + (req.path || '.') };
      }
      var entries = [];
      // @ts-ignore : values() existe sur FileSystemDirectoryHandle
      for await (var entry of ldir.values()) {
        entries.push({ name: entry.name, type: entry.kind === 'directory' ? 'dir' : 'file' });
        if (entries.length >= FS.LIMITS.MAX_LIST) break;
      }
      entries.sort(function (a, b) {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return { ok: true, entries: entries, truncated: entries.length >= FS.LIMITS.MAX_LIST };
    }
    return { ok: false, error: 'action inconnue' };
  }

  function labelOf(req) {
    return req.type === 'write' ? '✏️ write' : ('⚙️ ' + req.action);
  }

  // ---------- Renvoi du résultat à l'IA (envoi auto best-effort) ----------

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    try {
      var cs = window.getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    } catch (e) { /* ignore */ }
    return true;
  }

  function findChatInput() {
    var tas = document.querySelectorAll('textarea');
    for (var i = tas.length - 1; i >= 0; i--) {
      if (isVisible(tas[i]) && !tas[i].disabled && !tas[i].readOnly) {
        return { el: tas[i], type: 'textarea' };
      }
    }
    var eds = document.querySelectorAll('[contenteditable="true"]');
    for (var j = eds.length - 1; j >= 0; j--) {
      if (isVisible(eds[j])) return { el: eds[j], type: 'editable' };
    }
    return null;
  }

  function setInputText(input, text) {
    input.el.focus();
    if (input.type === 'textarea') {
      var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input.el, text);
      input.el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      var sel = window.getSelection();
      try { sel.selectAllChildren(input.el); } catch (e) { /* ignore */ }
      var ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
      if (!ok) {
        input.el.textContent = text;
        try {
          input.el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
        } catch (e2) {
          input.el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
  }

  function findSendButton(inputEl) {
    var form = inputEl.closest ? inputEl.closest('form') : null;
    if (form) {
      var sub = form.querySelector('button[type="submit"]');
      if (sub && isVisible(sub) && !sub.disabled) return { btn: sub };
    }
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (!isVisible(b) || b.disabled) continue;
      var label = ((b.getAttribute('aria-label') || '') + ' ' + (b.title || '') + ' ' + (b.textContent || '')).toLowerCase();
      if (/(envoyer|send|submit)/.test(label)) return { btn: b };
    }
    if (form && form.requestSubmit) return { form: form };
    return null;
  }

  // Attend que la page se calme (fin du streaming de l'IA) avant de répondre.
  function waitForQuiet(ms, max) {
    return new Promise(function (resolve) {
      var start = Date.now();
      var timer = null;
      var obs = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var t = muts[i].target;
          if (t && t.nodeType === 1 && t.closest && t.closest('#aa-panel,#aa-toast')) continue;
          arm();
          return;
        }
      });
      function cleanup() { clearTimeout(timer); try { obs.disconnect(); } catch (e) { /* ignore */ } }
      function arm() {
        clearTimeout(timer);
        if (Date.now() - start > max) { cleanup(); resolve(); return; }
        timer = setTimeout(function () { cleanup(); resolve(); }, ms);
      }
      try {
        obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      } catch (e) { resolve(); return; }
      arm();
    });
  }

  async function autoSend(text) {
    var input = findChatInput();
    if (!input) return { sent: false, reason: 'champ de saisie introuvable' };
    try {
      setInputText(input, text);
    } catch (e) {
      return { sent: false, reason: 'impossible de remplir le champ' };
    }
    await wait(400);
    try {
      var target = findSendButton(input.el);
      if (target && target.btn) target.btn.click();
      else if (target && target.form) target.form.requestSubmit();
      else input.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    } catch (e) { /* ignore, on vérifie ci-dessous */ }
    await wait(1200);
    var remaining = input.type === 'textarea' ? input.el.value : input.el.textContent;
    if (remaining && remaining.length > 10) {
      return { sent: false, reason: 'envoi non confirmé — appuie sur Entrée' };
    }
    return { sent: true };
  }

  // ---------- Boucle principale ----------

  function pruneTimes(now) {
    actionTimes = actionTimes.filter(function (t) { return now - t < 60000; });
  }

  function scan() {
    if (!enabled || needsAuth) return;
    var pres;
    try {
      pres = document.querySelectorAll('pre');
    } catch (e) { return; }
    var now = Date.now();
    for (var i = 0; i < pres.length; i++) {
      (function (pre) {
        if (done.has(pre)) return;
        if (pre.closest && pre.closest('#aa-panel,#aa-toast')) return;
        var text = '';
        try { text = pre.innerText || pre.textContent || ''; } catch (e) { return; }
        if (!text || text.length > 600 * 1024) return;
        var req;
        try { req = FS.parseActionBlock(text); } catch (e) { return; }
        if (!req || req.type === 'incomplete') return; // pas un bloc, ou en cours de frappe
        if (req.type === 'invalid') {
          var st0 = seen.get(pre) || {};
          if (!st0.invalidLogged) {
            st0.invalidLogged = true;
            seen.set(pre, st0);
            addLog('⚠️ Bloc ignoré', '', 'ko', req.reason);
          }
          return;
        }
        // Exige un texte stable (évite d'exécuter un bloc en cours de génération).
        var h = hash(text);
        var st = seen.get(pre) || {};
        if (st.hash !== h) {
          seen.set(pre, { hash: h, since: now, invalidLogged: st.invalidLogged });
          return;
        }
        if (now - st.since < STABLE_MS) return;
        done.add(pre);
        queue = queue.then(function () { return handle(req); }).catch(function (e) {
          addLog('❌ Erreur interne', '', 'ko', String((e && e.message) || e));
        });
      })(pres[i]);
    }
  }

  async function handle(req) {
    var now = Date.now();
    pruneTimes(now);
    if (actionTimes.length >= MAX_PER_MIN) {
      enabled = false;
      addLog('⏸️ Pause automatique', '', 'warn', 'trop d’actions (' + MAX_PER_MIN + '/min) — boucle possible, réactive avec ▶');
      toast('⏸️ Arena Auto en pause : trop d’actions. Réactive avec ▶ dans le panneau.', 8000);
      renderPanel();
      return;
    }
    var key = (req.type === 'write' ? 'w:' : 'a:' + req.action + ':') + req.path + ':' + hash(req.content || '');
    if (key === lastKey) {
      lastCount++;
      if (lastCount > 2) {
        addLog('🔁 Boucle détectée — action ignorée', req.path, 'ko', 'même action répétée, j’arrête de la rejouer');
        return;
      }
    } else { lastKey = key; lastCount = 1; }
    actionTimes.push(now);

    if (!dirHandle) {
      addLog('📁 Aucun dossier autorisé', req.path, 'ko', 'choisis ton dossier Documents dans le panneau (un seul clic)');
      toast('📁 Choisis ton dossier Documents dans le panneau 🤖 (un seul clic suffit).', 6000);
      return;
    }
    if (!(await ensurePermission())) {
      needsAuth = true;
      addLog('🔑 Autorisation perdue', req.path, 'ko', 'clique sur la page pour ré-autoriser');
      armClickRenew();
      renderPanel();
      return;
    }

    addLog(labelOf(req), req.path, 'run', 'exécution…');
    var outcome;
    try {
      outcome = await execute(req);
    } catch (e) {
      outcome = { ok: false, error: String((e && e.message) || e) };
    }
    // Remplace la ligne "run" par le résultat.
    if (log.length && log[0].status === 'run') log.shift();
    addLog(labelOf(req), req.path, outcome.ok ? 'ok' : 'ko', outcome.ok ? '' : outcome.error);

    var text = FS.formatResult(req, outcome);
    await waitForQuiet(QUIET_MS, 25000);
    if (!enabled) return;
    var sent = await autoSend(text);
    addLog(
      sent.sent ? '💬 Résultat renvoyé à l’IA' : '⌨️ Résultat pré-rempli — appuie sur Entrée',
      '',
      sent.sent ? 'ok' : 'warn',
      sent.sent ? '' : (sent.reason || '')
    );
  }

  // ---------- Panneau ----------

  function buildPanel() {
    if (document.getElementById('aa-panel')) return;
    var panel = document.createElement('div');
    panel.id = 'aa-panel';
    panel.innerHTML =
      '<div id="aa-header">' +
        '<span>🤖 <b>Arena Auto</b> <span id="aa-dot" class="on"></span></span>' +
        '<span><button id="aa-power" title="Activer / couper le pilote auto">⏸</button>' +
        '<button id="aa-toggle" title="Réduire / agrandir">—</button></span>' +
      '</div>' +
      '<div id="aa-body">' +
        '<div class="aa-row" id="aa-folder-row">' +
          '<span id="aa-folder-name">📁 …</span>' +
          '<button id="aa-pick" title="Choisir le dossier autorisé (ex: Documents)">Choisir…</button>' +
        '</div>' +
        '<div id="aa-log"></div>' +
        '<div id="aa-hint">💡 Colle les instructions système (voir README) dans Arena : l’IA lira/écrira/créera dans ce dossier, toute seule, sans confirmation.</div>' +
      '</div>';
    document.body.appendChild(panel);

    var collapsed = false;
    document.getElementById('aa-toggle').addEventListener('click', function () {
      collapsed = !collapsed;
      document.getElementById('aa-body').style.display = collapsed ? 'none' : 'block';
      document.getElementById('aa-toggle').textContent = collapsed ? '+' : '—';
    });
    document.getElementById('aa-power').addEventListener('click', function () {
      enabled = !enabled;
      addLog(enabled ? '▶ Pilote réactivé' : '⏸ Pilote coupé', '', 'info', '');
      renderPanel();
      if (enabled) scan();
    });
    document.getElementById('aa-pick').addEventListener('click', pickFolder);
  }

  function renderPanel() {
    var dot = document.getElementById('aa-dot');
    var power = document.getElementById('aa-power');
    var folder = document.getElementById('aa-folder-name');
    if (dot) dot.className = enabled ? 'on' : 'off';
    if (power) {
      power.textContent = enabled ? '⏸' : '▶';
      power.title = enabled ? 'Couper le pilote auto' : 'Réactiver le pilote auto';
    }
    if (folder) {
      if (!FS_OK) {
        folder.textContent = '📁 Écriture directe non supportée par ce navigateur';
      } else if (!dirHandle) {
        folder.textContent = '📁 Aucun dossier autorisé — clique Choisir…';
      } else if (needsAuth) {
        folder.textContent = '🔑 ' + dirName + ' (clique sur la page pour ré-autoriser)';
      } else {
        folder.textContent = '📁 ' + dirName + ' (sandbox actif ✅)';
      }
    }
    renderLog();
  }

  function renderLog() {
    var box = document.getElementById('aa-log');
    if (!box) return;
    if (!log.length) {
      box.innerHTML = '<div class="aa-empty">En attente… dès que l’IA émet un bloc ```arenafs, il s’exécute ici, sans confirmation.</div>';
      return;
    }
    box.innerHTML = log.slice(0, 6).map(function (e) {
      var cls = e.status === 'ok' ? 'aa-ok' : e.status === 'ko' ? 'aa-ko' : e.status === 'warn' ? 'aa-warn' : e.status === 'run' ? 'aa-run' : '';
      var line = '<div class="aa-entry ' + cls + '"><span class="aa-time">' + clock(e.t) + '</span> ' +
        esc(e.label) + (e.path ? ' <code>' + esc(e.path) + '</code>' : '') +
        (e.detail ? '<div class="aa-detail">' + esc(e.detail) + '</div>' : '') + '</div>';
      return line;
    }).join('');
  }

  // ---------- Observation de la page ----------

  var scanTimer = null;
  function observe() {
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var t = muts[i].target;
        if (t && t.nodeType === 1 && t.closest && t.closest('#aa-panel,#aa-toast')) continue;
        clearTimeout(scanTimer);
        scanTimer = setTimeout(scan, 700);
        return;
      }
    });
    try {
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (e) { /* ignore */ }
  }

  // ---------- Messages (popup) ----------

  if (window.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || !msg.type) return false;
      if (msg.type === 'aa-state') {
        sendResponse({
          ok: true, enabled: enabled, dirName: dirName, hasDir: !!dirHandle,
          needsAuth: needsAuth, fsOk: FS_OK, actions: actionTimes.length,
          log: log.slice(0, 8)
        });
        return false;
      }
      if (msg.type === 'aa-pick') {
        pickFolder().then(function (ok) { sendResponse({ ok: ok, dirName: dirName }); });
        return true;
      }
      if (msg.type === 'aa-toggle') {
        enabled = !enabled;
        addLog(enabled ? '▶ Pilote réactivé' : '⏸ Pilote coupé', '', 'info', '');
        renderPanel();
        if (enabled) scan();
        sendResponse({ ok: true, enabled: enabled });
        return false;
      }
      if (msg.type === 'aa-rescan') {
        scan();
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });
  }

  // ---------- Init ----------

  buildPanel();
  renderPanel();
  loadHandle().then(function () { scan(); });
  observe();
  setTimeout(scan, 2500); // rattrape les applis qui rendent tard (SPA)
})();
