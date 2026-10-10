/* Arena Auto Native — popup : état host + pilote + journal. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var tabId = null;

  function msg(text, cls) {
    var el = $('msg');
    el.textContent = text;
    el.className = cls || '';
  }

  function esc(s) {
    return String(s).replace(/[<>&]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c];
    });
  }

  function send(type, payload) {
    return new Promise(function (resolve) {
      if (tabId === null) { resolve(null); return; }
      chrome.tabs.sendMessage(tabId, Object.assign({ type: type }, payload || {}), function (resp) {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(resp || null);
      });
    });
  }

  function render(st) {
    if (!st) {
      $('host').textContent = '';
      $('host').className = '';
      $('stats').textContent = '';
      $('log').innerHTML = '';
      msg('Ouvre une conversation sur arena.ai/agent puis recharge la page (F5).', 'err');
      return;
    }
    $('dot').className = st.enabled ? 'on' : 'off';
    $('btn-toggle').textContent = st.enabled ? '⏸ Couper le pilote auto' : '▶ Réactiver le pilote auto';
    var host = $('host');
    if (st.hostOk === true) { host.textContent = '🔌 Programme local : connecté ✅'; host.className = 'ok'; }
    else if (st.hostOk === false) { host.textContent = '🔌 Programme local : injoignable ❌ (voir README)'; host.className = 'ko'; }
    else { host.textContent = '🔌 Programme local : …'; host.className = ''; }
    $('stats').textContent = st.actions + ' action(s) la dernière minute';
    $('log').innerHTML = (st.log || []).map(function (e) {
      var cls = e.status === 'ok' ? 'an-ok' : e.status === 'ko' ? 'an-ko' : e.status === 'warn' ? 'an-warn' : '';
      return '<div class="' + cls + '">' + esc(e.label) +
        (e.path ? ' <code>' + esc(e.path) + '</code>' : '') +
        (e.detail ? '<br>' + esc(e.detail) : '') + '</div>';
    }).join('') || '<div>En attente d’actions de l’IA…</div>';
  }

  async function refresh() {
    render(await send('an-state'));
  }

  function busy(b) {
    ['btn-toggle', 'btn-test', 'btn-rescan'].forEach(function (id) { $(id).disabled = b; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || !/^https:\/\/(www\.)?(arena|lmarena)\.ai\//.test(tab.url || '')) {
        render(null);
        return;
      }
      tabId = tab.id;
      refresh();

      $('btn-toggle').addEventListener('click', async function () {
        busy(true);
        var r = await send('an-toggle');
        busy(false);
        if (r) { msg(r.enabled ? 'Pilote réactivé.' : 'Pilote coupé.', 'ok'); refresh(); }
        else msg('Pas de réponse — recharge la page (F5).', 'err');
      });

      $('btn-test').addEventListener('click', async function () {
        busy(true); msg('Test de connexion…');
        var r = await send('an-test');
        busy(false);
        if (r && r.ok) { msg('Programme local connecté ✅', 'ok'); refresh(); }
        else msg('Injoignable : installe le host (README) puis redémarre Edge.', 'err');
      });

      $('btn-rescan').addEventListener('click', async function () {
        busy(true);
        await send('an-rescan');
        await refresh();
        busy(false);
      });
    });
  });
})();
