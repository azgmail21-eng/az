/*!
 * Arena Auto — autofs.js
 * Format d'actions + sandbox "dossier autorisé uniquement".
 * Pur JS (aucune API chrome.*) => testable sous Node.
 *
 * Format reconnu dans les réponses de l'IA (UN bloc = UNE action) :
 *
 *   ```arenafs
 *   WRITE: projet/app.py
 *   ---
 *   <contenu exact du fichier>
 *   ```
 *
 *   ```arenafs
 *   ACTION: read | list | mkdir
 *   PATH: projet/app.py
 *   ```
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ArenaAutoFS = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = {
    MAX_WRITE: 500 * 1024, // contenu WRITE accepté
    MAX_READ: 100 * 1024,  // contenu renvoyé à l'IA pour read
    MAX_LIST: 200,         // entrées listées
    MAX_PATH: 200          // longueur du chemin relatif
  };

  var SIMPLE_ACTIONS = { read: 1, list: 1, mkdir: 1 };

  function stripQuotes(s) {
    return String(s).replace(/^["'`]+|["'`]+$/g, '');
  }

  // Analyse le texte d'un bloc <pre>. Retourne :
  //  {type:'write', path, content} | {type:'action', action, path}
  //  | {type:'incomplete'} (en cours de frappe, réessayer plus tard)
  //  | {type:'invalid', reason} | null (pas un bloc d'action)
  function parseActionBlock(raw) {
    var text = String(raw || '').replace(/\r\n/g, '\n');
    var trimmed = text.trim();
    if (!trimmed) return null;
    var firstNL = trimmed.indexOf('\n');
    var firstLine = (firstNL === -1 ? trimmed : trimmed.slice(0, firstNL)).trim();

    var mWrite = firstLine.match(/^WRITE\s*:\s*(.+)$/i);
    var mAction = firstLine.match(/^ACTION\s*:\s*(.+)$/i);
    if (!mWrite && !mAction) return null;

    if (mWrite) {
      var path = stripQuotes(mWrite[1].trim());
      if (!path) return { type: 'invalid', reason: 'WRITE sans chemin' };
      if (firstNL === -1) return { type: 'incomplete', reason: 'contenu manquant' };
      var rest = trimmed.slice(firstNL + 1);
      if (!rest.startsWith('---')) {
        return rest.trim()
          ? { type: 'invalid', reason: 'ligne séparatrice --- manquante après WRITE:' }
          : { type: 'incomplete', reason: 'en cours de frappe' };
      }
      var content = rest.slice(3);
      if (content.charAt(0) === '\n') content = content.slice(1);
      return { type: 'write', path: path, content: content };
    }

    var action = stripQuotes(mAction[1].trim()).toLowerCase();
    if (!SIMPLE_ACTIONS[action]) {
      return { type: 'invalid', reason: 'ACTION inconnue "' + action + '" (read, list, mkdir)' };
    }
    var lines = trimmed.split('\n').slice(1);
    var found = null;
    for (var i = 0; i < lines.length; i++) {
      var mm = lines[i].match(/^\s*PATH\s*:\s*(.+)$/i);
      if (mm) { found = stripQuotes(mm[1].trim()); break; }
    }
    if (!found) return { type: 'incomplete', reason: 'ligne PATH: manquante (peut-être en cours de frappe)' };
    return { type: 'action', action: action, path: found };
  }

  // Sandbox : n'accepte QUE des chemins relatifs restant dans le dossier
  // autorisé. Retourne la liste des segments, ou null si refusé.
  function resolveInside(p) {
    if (typeof p !== 'string') return null;
    // list sans chemin / "." = racine du dossier autorisé
    var s = p.replace(/\\/g, '/').trim();
    if (s === '' || s === '.' || s === './') return [];
    if (s.length > LIMITS.MAX_PATH) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return null; // "C:", "file:", ...
    if (s.charAt(0) === '/') return null;                 // chemin absolu
    var segs = [];
    var parts = s.split('/');
    for (var i = 0; i < parts.length; i++) {
      // Segments vides (slash final "projet/" ou double slash) : inoffensifs, on saute.
      if (!parts[i]) continue;
      var seg = parts[i].replace(/[\x00-\x1F<>:"|?*]/g, '_').replace(/[. ]+$/g, '').trim();
      if (!seg || seg === '.' || seg === '..') return null; // remonte interdite
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(seg)) seg = '_' + seg;
      segs.push(seg.slice(0, 120));
    }
    if (!segs.length) return null;
    return segs;
  }

  function truncate(s, max) {
    s = String(s == null ? '' : s);
    if (s.length <= max) return { text: s, cut: false };
    return { text: s.slice(0, max), cut: true };
  }

  // Construit le message renvoyé à l'IA après exécution.
  // outcome: {ok:true, ...} | {ok:false, error}
  function formatResult(req, outcome) {
    var path = req.path || '';
    var tag = '📁 [Arena Auto] ';
    if (!outcome || !outcome.ok) {
      var what = req.type === 'write' ? 'write' : req.action;
      return tag + what + ' ' + path + ' : ERREUR — ' + ((outcome && outcome.error) || 'échec inconnu');
    }
    if (req.type === 'write') {
      return tag + 'write ' + path + ' : OK (' + outcome.bytes + ' octets écrits dans Documents)';
    }
    if (req.action === 'mkdir') {
      return tag + 'mkdir ' + path + ' : OK (dossier créé dans Documents)';
    }
    if (req.action === 'read') {
      var t = truncate(outcome.content || '', LIMITS.MAX_READ);
      return tag + 'read ' + path + ' :\n' + t.text + (t.cut ? '\n…(contenu tronqué à ' + LIMITS.MAX_READ / 1024 + ' Ko)' : '');
    }
    if (req.action === 'list') {
      var entries = outcome.entries || [];
      if (!entries.length) return tag + 'list ' + (path || '.') + ' : (dossier vide)';
      var lines = entries.map(function (e) {
        return (e.type === 'dir' ? '[DIR]  ' : '[FILE] ') + e.name;
      });
      var joined = lines.join('\n');
      if (outcome.truncated) joined += '\n…(liste tronquée à ' + LIMITS.MAX_LIST + ' entrées)';
      return tag + 'list ' + (path || '.') + ' :\n' + joined;
    }
    return tag + 'OK';
  }

  return {
    LIMITS: LIMITS,
    parseActionBlock: parseActionBlock,
    resolveInside: resolveInside,
    formatResult: formatResult,
    truncate: truncate
  };
});
