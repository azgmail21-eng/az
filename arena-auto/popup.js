/* Arena Auto — popup : état du pilote + journal + interrupteur. */
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
      $('folder').textContent = '📁 …';
      $('stats').textContent = '';
      $('log').innerHTML = '';
      msg('Ouvre une conversation sur arena.ai/agent puis recharge la page (F5).', 'err');
      return;
    }
    $('dot').className = st.enabled ? 'on' : 'off';
    $('btn-toggle').textContent = st.enabled ? '⏸ Couper le pilote auto' : '▶ Réactiver le pilote auto';
    if (!st.fsOk) {
      $('folder').textContent = '📁 Écriture directe non supportée par ce navigateur';
    } else if (!st.hasDir) {
      $('folder').textContent = '📁 Aucun dossier autorisé — clique « Choisir… »';
    } else if (st.needsAuth) {
      $('folder').textContent = '🔑 ' + st.dirName + ' — clique sur la page pour ré-autoriser';
    } else {
      $('folder').textContent = '📁 ' + st.dirName + ' (sandbox actif ✅)';
    }
    $('stats').textContent = st.actions + ' action(s) la dernière minute';
    $('log').innerHTML = (st.log || []).map(function (e) {
      var cls = e.status === 'ok' ? 'aa-ok' : e.status === 'ko' ? 'aa-ko' : e.status === 'warn' ? 'aa-warn' : '';
      return '<div class="' + cls + '">' + esc(e.label) +
        (e.path ? ' <code>' + esc(e.path) + '</code>' : '') +
        (e.detail ? '<br>' + esc(e.detail) : '') + '</div>';
    }).join('') || '<div>En attente d’actions de l’IA…</div>';
  }

  async function refresh() {
    render(await send('aa-state'));
  }

  function busy(b) {
    ['btn-toggle', 'btn-pick', 'btn-rescan'].forEach(function (id) { $(id).disabled = b; });
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
        var r = await send('aa-toggle');
        busy(false);
        if (r) { msg(r.enabled ? 'Pilote réactivé.' : 'Pilote coupé.', 'ok'); refresh(); }
        else msg('Pas de réponse — recharge la page (F5).', 'err');
      });

      $('btn-pick').addEventListener('click', async function () {
        busy(true); msg('Sélection du dossier… (regarde la page)');
        var r = await send('aa-pick');
        busy(false);
        if (r && r.ok) { msg('Dossier autorisé : ' + r.dirName, 'ok'); refresh(); }
        else msg('Si rien ne s’ouvre : clique « Choisir… » dans le panneau SUR la page.', 'err');
      });

      $('btn-rescan').addEventListener('click', async function () {
        busy(true);
        await send('aa-rescan');
        await refresh();
        busy(false);
      });
    });
  });
})();
