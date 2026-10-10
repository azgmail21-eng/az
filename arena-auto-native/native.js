/* Arena Auto Native — l'IA pilote Documents via le host natif, ZÉRO clic.
 * Repose sur autofs.js (window.ArenaAutoFS) chargé avant.
 * Aucun sélecteur de dossier, aucune confirmation, aucune ré-autorisation :
 * le host local est verrouillé sur Documents (côté programme, non modifiable). */
(function () {
  'use strict';
  if (window.__anInjected) return;
  window.__anInjected = true;

  var FS = window.ArenaAutoFS;
  if (!FS) return;

  var MAX_PER_MIN = 20;
  var STABLE_MS = 1500;
  var QUIET_MS = 2500;

  var enabled = true;
  var hostOk = null; // null = inconnu, true/false = testé
  var downNotified = false;
  var log = [];
  var actionTimes = [];
  var lastKey = null, lastCount = 0;

  var seen = new WeakMap();
  var done = new WeakSet();
  var queue = Promise.resolve();

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
    var el = document.getElementById('an-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'an-toast';
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

  // ---------- Appels au host natif ----------

  function callHost(payload) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) { settled = true; resolve({ ok: false, error: 'Timeout (35 s) sans réponse du host.' }); }
      }, 35000);
      try {
        chrome.runtime.sendMessage({ type: 'aan-request', payload: payload }, function (resp) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp || { ok: false, error: 'Réponse vide du host.' });
          }
        });
      } catch (e) {
        if (!settled) { settled = true; clearTimeout(timer); resolve({ ok: false, error: String(e.message || e) }); }
      }
    });
  }

  async function testHost(silent) {
    var res = await callHost({ action: 'ping' });
    hostOk = !!(res && res.ok);
    downNotified = false;
    if (!silent) {
      if (hostOk) {
        addLog('🔌 Host connecté', '', 'ok', 'Documents : ' + (res.baseDir || ''));
        toast('✅ Host connecté : ' + (res.baseDir || 'Documents'));
      } else {
        addLog('🔌 Host injoignable', '', 'ko', (res && res.error) || '');
        toast('❌ Host injoignable — installe-le (voir README) puis redémarre Edge.', 7000);
      }
    }
    renderPanel();
    return hostOk;
  }

  async function execute(req) {
    // Vérif côté extension (le host revérifie de son côté : double sandbox).
    if (!FS.resolveInside(req.path)) {
      return { ok: false, error: 'chemin refusé par la sandbox (relatif à Documents uniquement)' };
    }
    var payload;
    if (req.type === 'write') {
      payload = { action: 'write', path: req.path, content: req.content };
    } else {
      payload = { action: req.action, path: req.path };
    }
    var res = await callHost(payload);
    if (!res || !res.ok) {
      hostOk = false;
      renderPanel();
      return { ok: false, error: (res && res.error) || 'erreur host inconnue' };
    }
    if (hostOk !== true) { hostOk = true; renderPanel(); }
    return res;
  }

  function labelOf(req) {
    return req.type === 'write' ? '✏️ write' : ('⚙️ ' + req.action);
  }

  // ---------- Renvoi du résultat à l'IA ----------

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

  function waitForQuiet(ms, max) {
    return new Promise(function (resolve) {
      var start = Date.now();
      var timer = null;
      var obs = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var t = muts[i].target;
          if (t && t.nodeType === 1 && t.closest && t.closest('#an-panel,#an-toast')) continue;
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
    if (!enabled) return;
    var pres;
    try {
      pres = document.querySelectorAll('pre');
    } catch (e) { return; }
    var now = Date.now();
    for (var i = 0; i < pres.length; i++) {
      (function (pre) {
        if (done.has(pre)) return;
        if (pre.closest && pre.closest('#an-panel,#an-toast')) return;
        var text = '';
        try { text = pre.innerText || pre.textContent || ''; } catch (e) { return; }
        if (!text || text.length > 600 * 1024) return;
        var req;
        try { req = FS.parseActionBlock(text); } catch (e) { return; }
        if (!req || req.type === 'incomplete') return;
        if (req.type === 'invalid') {
          var st0 = seen.get(pre) || {};
          if (!st0.invalidLogged) {
            st0.invalidLogged = true;
            seen.set(pre, st0);
            addLog('⚠️ Bloc ignoré', '', 'ko', req.reason);
          }
          return;
        }
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
      addLog('⏸️ Pause automatique', '', 'warn', 'trop d’actions (' + MAX_PER_MIN + '/min) — réactive avec ▶');
      toast('⏸️ Pause auto : trop d’actions. Réactive avec ▶ dans le panneau.', 8000);
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

    if (hostOk === null) await testHost(true);
    if (hostOk === false) {
      if (!downNotified) {
        downNotified = true;
        addLog('🔌 Host injoignable', req.path, 'ko', 'installe le host (voir README) puis redémarre Edge ; actions en attente');
        toast('❌ Host injoignable — installe-le (voir README) puis redémarre Edge.', 7000);
      }
      return;
    }

    addLog(labelOf(req), req.path, 'run', 'exécution…');
    var outcome;
    try {
      outcome = await execute(req);
    } catch (e) {
      outcome = { ok: false, error: String((e && e.message) || e) };
    }
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
    if (document.getElementById('an-panel')) return;
    var panel = document.createElement('div');
    panel.id = 'an-panel';
    panel.innerHTML =
      '<div id="an-header">' +
        '<span>⚡ <b>Arena Native</b> <span id="an-dot" class="on"></span></span>' +
        '<span><button id="an-power" title="Activer / couper le pilote auto">⏸</button>' +
        '<button id="an-toggle" title="Réduire / agrandir">—</button></span>' +
      '</div>' +
      '<div id="an-body">' +
        '<div class="an-row" id="an-folder-row">' +
          '<span id="an-folder-name">📁 …</span>' +
          '<button id="an-test" title="Vérifier la connexion au programme local">Tester</button>' +
        '</div>' +
        '<div id="an-log"></div>' +
        '<div id="an-hint">💡 Colle les instructions système (voir README) dans Arena : l’IA lira/écrira/créera dans Documents, sans aucun clic.</div>' +
      '</div>';
    document.body.appendChild(panel);

    var collapsed = false;
    document.getElementById('an-toggle').addEventListener('click', function () {
      collapsed = !collapsed;
      document.getElementById('an-body').style.display = collapsed ? 'none' : 'block';
      document.getElementById('an-toggle').textContent = collapsed ? '+' : '—';
    });
    document.getElementById('an-power').addEventListener('click', function () {
      enabled = !enabled;
      addLog(enabled ? '▶ Pilote réactivé' : '⏸ Pilote coupé', '', 'info', '');
      renderPanel();
      if (enabled) scan();
    });
    document.getElementById('an-test').addEventListener('click', function () { testHost(false); });
  }

  function renderPanel() {
    var dot = document.getElementById('an-dot');
    var power = document.getElementById('an-power');
    var folder = document.getElementById('an-folder-name');
    if (dot) dot.className = enabled ? 'on' : 'off';
    if (power) {
      power.textContent = enabled ? '⏸' : '▶';
      power.title = enabled ? 'Couper le pilote auto' : 'Réactiver le pilote auto';
    }
    if (folder) {
      var status = hostOk === null ? '…' : hostOk ? '✅' : '❌';
      folder.textContent = '📁 Documents (imposé 🔒) ' + status;
      folder.title = hostOk === false
        ? 'Programme local injoignable : installe-le (voir README) puis redémarre Edge'
        : 'Tout reste dans Documents, via le programme local';
    }
    renderLog();
  }

  function renderLog() {
    var box = document.getElementById('an-log');
    if (!box) return;
    if (!log.length) {
      box.innerHTML = '<div class="an-empty">En attente… dès que l’IA émet un bloc ```arenafs, il s’exécute ici, sans aucun clic.</div>';
      return;
    }
    box.innerHTML = log.slice(0, 6).map(function (e) {
      var cls = e.status === 'ok' ? 'an-ok' : e.status === 'ko' ? 'an-ko' : e.status === 'warn' ? 'an-warn' : e.status === 'run' ? 'an-run' : '';
      return '<div class="an-entry ' + cls + '"><span class="an-time">' + clock(e.t) + '</span> ' +
        esc(e.label) + (e.path ? ' <code>' + esc(e.path) + '</code>' : '') +
        (e.detail ? '<div class="an-detail">' + esc(e.detail) + '</div>' : '') + '</div>';
    }).join('');
  }

  // ---------- Observation ----------

  var scanTimer = null;
  function observe() {
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var t = muts[i].target;
        if (t && t.nodeType === 1 && t.closest && t.closest('#an-panel,#an-toast')) continue;
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
      if (msg.type === 'an-state') {
        sendResponse({
          ok: true, enabled: enabled, hostOk: hostOk,
          actions: actionTimes.length, log: log.slice(0, 8)
        });
        return false;
      }
      if (msg.type === 'an-test') {
        testHost(false).then(function (ok) { sendResponse({ ok: ok }); });
        return true;
      }
      if (msg.type === 'an-toggle') {
        enabled = !enabled;
        addLog(enabled ? '▶ Pilote réactivé' : '⏸ Pilote coupé', '', 'info', '');
        renderPanel();
        if (enabled) scan();
        sendResponse({ ok: true, enabled: enabled });
        return false;
      }
      if (msg.type === 'an-rescan') {
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
  testHost(true).then(function () { scan(); });
  observe();
  setTimeout(scan, 2500);
})();
