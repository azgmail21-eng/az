/* Arena Saver — popup : état + actions rapides (relaye vers le content script). */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var tabId = null;

  function msg(text, cls) {
    var el = $('msg');
    el.textContent = text;
    el.className = cls || '';
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
      $('count').textContent = '?';
      $('folder').textContent = '📁 …';
      $('files').innerHTML = '';
      msg('Ouvre une conversation sur arena.ai/agent puis recharge la page (F5).', 'err');
      return;
    }
    $('count').textContent = String(st.count);
    $('folder').textContent = st.hasDir ? ('📁 ' + (st.dirName || 'dossier choisi')) : '📁 Aucun dossier choisi';
    if (!st.fsOk) {
      $('folder').textContent += ' — écriture directe non supportée, utilise le ZIP';
    }
    $('files').innerHTML = (st.files || []).map(function (f) {
      var icon = f.kind === 'link' ? '🔗' : (f.from === 'fallback' ? '✏️' : '📄');
      return '<div title="' + f.filename.replace(/"/g, '&quot;') + '">' + icon + ' ' +
        f.filename.replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }) + '</div>';
    }).join('') || '<div>Aucun fichier détecté.</div>';
  }

  async function refresh() {
    var st = await send('ars-state');
    render(st);
    return st;
  }

  function busy(b) {
    ['btn-save', 'btn-zip', 'btn-pick', 'btn-rescan'].forEach(function (id) { $(id).disabled = b; });
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

      $('btn-save').addEventListener('click', async function () {
        busy(true); msg('Sauvegarde en cours… (voir la page)');
        var r = await send('ars-save');
        busy(false);
        if (!r) { msg('Pas de réponse — recharge la page (F5).', 'err'); return; }
        if (r.fallback === 'zip') msg('Pas de dossier choisi : ZIP téléchargé à la place. Astuce : choisis ton dossier depuis le panneau sur la page.', 'ok');
        else msg(r.failed ? (r.saved + ' OK, ' + r.failed + ' échec(s) — voir la page.') : (r.saved + ' fichier(s) sauvegardé(s) ✅'), r.failed ? 'err' : 'ok');
        refresh();
      });

      $('btn-zip').addEventListener('click', async function () {
        busy(true); msg('Création du ZIP…');
        var r = await send('ars-zip');
        busy(false);
        msg(r ? 'ZIP téléchargé ✅' : 'Pas de réponse — recharge la page (F5).', r ? 'ok' : 'err');
      });

      $('btn-pick').addEventListener('click', async function () {
        busy(true); msg('Sélection du dossier… (regarde la page)');
        var r = await send('ars-pick');
        busy(false);
        if (r && r.ok) { msg('Dossier enregistré : ' + r.dirName, 'ok'); refresh(); }
        else msg('Si rien ne s’ouvre : clique « Choisir… » dans le panneau SUR la page (le navigateur exige un clic dans la page).', 'err');
      });

      $('btn-rescan').addEventListener('click', async function () {
        busy(true);
        await send('ars-rescan');
        await refresh();
        busy(false);
      });
    });
  });
})();
