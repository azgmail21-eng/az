/*!
 * Arena Saver — detect.js
 * Détection des fichiers / blocs de code dans les réponses de l'agent Arena.
 * Pur DOM (aucune API chrome.*) => testable sous Node avec jsdom.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ArenaDetect = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Langage (tel que rendu, ex: class="language-python") -> extension de fichier.
  var LANGUAGE_EXT = {
    python: 'py', py: 'py', python3: 'py',
    javascript: 'js', js: 'js', jsx: 'jsx', mjs: 'mjs', cjs: 'cjs',
    typescript: 'ts', ts: 'ts', tsx: 'tsx',
    java: 'java', kotlin: 'kt', kts: 'kt', scala: 'scala', groovy: 'groovy',
    c: 'c', h: 'h', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', hpp: 'hpp',
    csharp: 'cs', 'c#': 'cs', cs: 'cs',
    go: 'go', rust: 'rs', rs: 'rs', ruby: 'rb', rb: 'rb', php: 'php',
    swift: 'swift', objectivec: 'm', 'objective-c': 'm',
    html: 'html', xml: 'xml', vue: 'vue', svelte: 'svelte', astro: 'astro',
    css: 'css', scss: 'scss', sass: 'sass', less: 'less',
    json: 'json', jsonc: 'jsonc', yaml: 'yml', yml: 'yml', toml: 'toml',
    ini: 'ini', cfg: 'cfg', conf: 'conf', env: 'env', dotenv: 'env',
    markdown: 'md', md: 'md', mdx: 'mdx', rst: 'rst', tex: 'tex', latex: 'tex',
    shell: 'sh', bash: 'sh', sh: 'sh', zsh: 'zsh',
    powershell: 'ps1', ps1: 'ps1', bat: 'bat', batch: 'bat', cmd: 'bat',
    sql: 'sql', r: 'r', julia: 'jl', jl: 'jl', lua: 'lua', perl: 'pl', pl: 'pl',
    dart: 'dart', haskell: 'hs', hs: 'hs', elixir: 'ex', ex: 'ex', erlang: 'erl',
    clojure: 'clj', dockerfile: 'Dockerfile', docker: 'Dockerfile',
    makefile: 'Makefile', make: 'Makefile', cmake: 'cmake',
    diff: 'diff', patch: 'patch', graphql: 'graphql', gql: 'graphql',
    solidity: 'sol', sol: 'sol', wat: 'wat',
    text: 'txt', txt: 'txt', plaintext: 'txt', log: 'log',
    csv: 'csv', tsv: 'tsv', pdf: 'pdf'
  };

  var EXTRA_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico',
    'zip', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];

  var SPECIAL_BASENAMES = ['dockerfile', 'makefile', 'cmakelists.txt',
    '.gitignore', '.env', '.editorconfig', 'readme.md', 'license'];

  function knownExts() {
    var set = {};
    Object.keys(LANGUAGE_EXT).forEach(function (k) { set[LANGUAGE_EXT[k]] = 1; });
    EXTRA_EXTS.forEach(function (e) { set[e] = 1; });
    return Object.keys(set);
  }

  var TOKEN_RE = null;
  function tokenRegex() {
    if (TOKEN_RE) return TOKEN_RE;
    var exts = knownExts()
      .filter(function (e) { return e.indexOf('.') === -1 && /^[a-z0-9]+$/i.test(e); })
      .sort(function (a, b) { return b.length - a.length; })
      .map(function (e) { return e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); })
      .join('|');
    // Ex: app.py, src/utils/helpers.test.ts, mon-fichier_v2.js
    TOKEN_RE = new RegExp(
      '((?:[\\w][\\w\\-.+%@~]*/)*[\\w][\\w\\-.+%@~]*\\.(?:' + exts + '))(?![\\w.])',
      'gi'
    );
    return TOKEN_RE;
  }

  // Extrait un nom de fichier plausible d'un bout de texte (titre, en-tête...).
  // Retourne null si rien de convaincant. Ne scanne JAMAIS le contenu du code
  // (trop bruyant), uniquement des zones structurelles courtes.
  function extractFilenameToken(text) {
    if (!text) return null;
    var s = String(text).replace(/[“”«»]/g, '"').trim();
    if (!s || s.length > 180) return null;

    // Noms spéciaux sans extension classique (Dockerfile, Makefile, .env...)
    var low = s.toLowerCase().replace(/^["'`]+|["'`]+$/g, '');
    for (var i = 0; i < SPECIAL_BASENAMES.length; i++) {
      if (low === SPECIAL_BASENAMES[i]) return s.replace(/^["'`]+|["'`]+$/g, '');
    }

    var re = tokenRegex();
    re.lastIndex = 0;
    var best = null, m;
    while ((m = re.exec(s)) !== null) {
      // Ignore si collé à un mot plus long devant (ex: "monapp.py" dans "xxmonapp.py").
      var prev = m.index > 0 ? s[m.index - 1] : '';
      if (/[\w.]/.test(prev)) continue;
      var cand = m[1];
      if (cand.length > 120) continue;
      if (cand.split('/').some(function (seg) { return seg === '..' || !seg; })) continue;
      // Préfère le plus long (un chemin "src/app.py" bat "app.py").
      if (!best || cand.length > best.length) best = cand;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return best;
  }

  function looksLikeRelPath(v) {
    return typeof v === 'string' && v.length > 0 && v.length <= 180 &&
      v.indexOf('\n') === -1 && extractFilenameToken(v) !== null;
  }

  function classString(el) {
    if (!el || !el.className) return '';
    if (typeof el.className === 'string') return el.className;
    if (el.className.baseVal !== undefined) return el.className.baseVal; // SVG
    return String(el.className);
  }

  // ---- Détection du langage ----

  function rawLanguage(pre) {
    var els = [pre.querySelector ? pre.querySelector('code') : null, pre,
      pre.parentElement, pre.parentElement && pre.parentElement.parentElement];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el || !el.getAttribute) continue;
      var dl = el.getAttribute('data-language') || el.getAttribute('data-lang');
      if (dl) return String(dl).toLowerCase().trim();
      var cls = classString(el);
      var m = cls.match(/(?:language|lang)-([A-Za-z0-9#+._:-]+)/);
      if (m) return m[1].toLowerCase();
    }
    return null;
  }

  function detectLanguage(pre) {
    var raw = rawLanguage(pre);
    if (!raw) return null;
    raw = raw.split(':')[0]; // retire une éventuelle info "python:app.py"
    if (LANGUAGE_EXT[raw]) return raw;
    return null;
  }

  // Nom de fichier éventuellement collé à l'info de langage ("python:app.py").
  function fenceInfoFilename(pre) {
    var raw = rawLanguage(pre);
    if (!raw || raw.indexOf(':') === -1) return null;
    var after = raw.split(':').slice(1).join(':');
    var t = extractFilenameToken(after);
    return t;
  }

  // ---- Indices structurels ----

  function dataFilename(pre) {
    var els = [pre, pre.querySelector ? pre.querySelector('code') : null,
      pre.parentElement, pre.parentElement && pre.parentElement.parentElement];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el || !el.getAttribute) continue;
      var v = el.getAttribute('data-filename') || el.getAttribute('data-file-name') ||
        el.getAttribute('data-file') || el.getAttribute('data-path') ||
        el.getAttribute('data-title') || el.getAttribute('title');
      if (v && looksLikeRelPath(v)) return extractFilenameToken(v);
    }
    return null;
  }

  function headerHints(pre) {
    var hints = [];
    function push(el, weight) {
      if (!el || !el.textContent) return;
      // Les en-têtes contiennent souvent un bouton "Copier" collé au nom
      // ("app.pyCopier") : on retire les boutons avant de lire le texte.
      var t;
      if (el.querySelector && el.querySelector('button')) {
        var c = el.cloneNode(true);
        var btns = c.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].parentNode) btns[i].parentNode.removeChild(btns[i]);
        }
        t = (c.textContent || '').replace(/\s+/g, ' ').trim();
      } else {
        t = el.textContent.replace(/\s+/g, ' ').trim();
      }
      if (!t || t.length > 160) return;
      hints.push({ text: t, weight: weight });
    }
    var sib = pre.previousElementSibling, n = 0;
    while (sib && n < 2) { push(sib, 1); sib = sib.previousElementSibling; n++; }
    var node = pre.parentElement, depth = 0;
    while (node && depth < 3) {
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k === pre || (k.contains && k.contains(pre))) continue;
        var cls = classString(k);
        var testid = (k.getAttribute && (k.getAttribute('data-testid') || '')) || '';
        var role = (k.getAttribute && (k.getAttribute('role') || '')) || '';
        if (/file|filename|title|header|caption|name|path/i.test(cls + ' ' + k.tagName + ' ' + testid + ' ' + role)) {
          push(k, 3);
        } else if (k.tagName === 'FIGCAPTION' || k.tagName === 'HEADER') {
          push(k, 2);
        }
      }
      node = node.parentElement; depth++;
    }
    hints.sort(function (a, b) { return b.weight - a.weight; });
    return hints;
  }

  // Première ligne du code, UNIQUEMENT si elle est juste un nom de fichier
  // (éventuellement en commentaire) : "# app.py", "// server.js", "Fichier: a.py"...
  function firstLineFilename(codeText) {
    var line = String(codeText || '').split('\n')[0] || '';
    var m = line.match(/^\s*(?:\/\/|#|--|;|%|\*|<!--|')?\s*(?:fichier|file(?:name)?)?\s*[:=]?\s*(.+?)\s*(?:\*\/|-->)?\s*$/i);
    if (!m) return null;
    var inner = m[1].trim();
    if (!inner) return null;
    var token = extractFilenameToken(inner);
    if (token && inner === token) return token;
    return null;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function inferFilename(pre, codeText, index, lang) {
    var t;
    t = dataFilename(pre);
    if (t) return { name: t, from: 'data' };
    t = fenceInfoFilename(pre);
    if (t) return { name: t, from: 'info' };
    var hints = headerHints(pre);
    for (var i = 0; i < hints.length; i++) {
      t = extractFilenameToken(hints[i].text);
      if (t) return { name: t, from: 'header' };
    }
    t = firstLineFilename(codeText);
    if (t) return { name: t, from: 'comment' };
    var ext = (lang && LANGUAGE_EXT[lang]) || 'txt';
    if (ext === 'Dockerfile' || ext === 'Makefile') {
      return { name: ext, from: 'fallback' };
    }
    var base = (lang && lang !== 'text' && lang !== 'plaintext' && lang !== 'txt') ? lang : 'snippet';
    return { name: 'arena-' + base + '-' + pad2(index + 1) + '.' + ext, from: 'fallback' };
  }

  // ---- Extraction du texte du code ----

  var JUNK_CLASS_RE = /copy|copié|clipboard|line-?number|lineno|gutter|fold|ars-save-btn/i;

  function extractCodeText(pre) {
    var clone = pre.cloneNode(true);
    var els = clone.querySelectorAll('*');
    for (var i = els.length - 1; i >= 0; i--) {
      var el = els[i];
      if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') {
        el.parentNode.removeChild(el);
      } else if (JUNK_CLASS_RE.test(classString(el))) {
        el.parentNode.removeChild(el);
      }
    }
    var text = '';
    try {
      if (typeof clone.innerText === 'string' && clone.innerText) text = clone.innerText;
    } catch (e) { /* jsdom / vieux moteurs */ }
    if (!text) text = clone.textContent || '';
    text = String(text).replace(/\r\n/g, '\n').replace(/\n+$/, '');
    return text;
  }

  // ---- Divers ----

  function sanitizeRelPath(name) {
    var s = String(name || '').replace(/\\/g, '/').trim().replace(/^\/+/, '');
    var out = [];
    s.split('/').forEach(function (seg) {
      seg = seg.replace(/[<>:"|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').trim();
      if (!seg || seg === '.' || seg === '..') return;
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(seg)) seg = '_' + seg;
      out.push(seg.slice(0, 120));
    });
    if (!out.length) out.push('arena-fichier.txt');
    return out.join('/');
  }

  function ensureUniqueNames(artifacts) {
    var seen = {};
    artifacts.forEach(function (a) {
      var name = a.filename;
      if (!seen[name]) { seen[name] = 1; return; }
      seen[name]++;
      var n = seen[name];
      var dot = name.lastIndexOf('.');
      var slash = name.lastIndexOf('/');
      var renamed;
      if (dot > slash + 1) {
        renamed = name.slice(0, dot) + ' (' + n + ')' + name.slice(dot);
      } else {
        renamed = name + ' (' + n + ')';
      }
      while (seen[renamed]) { n++; renamed = (dot > slash + 1 ? name.slice(0, dot) + ' (' + n + ')' + name.slice(dot) : name + ' (' + n + ')'); }
      seen[renamed] = 1;
      a.filename = renamed;
    });
    return artifacts;
  }

  function hashContent(s) {
    var h = 5381;
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function isOurUI(el) {
    return !!(el && el.closest && el.closest('#ars-panel,#ars-toast'));
  }

  function collectCodeArtifacts(doc) {
    var pres = doc.querySelectorAll('pre');
    var out = [];
    var seenContent = {};
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i];
      if (isOurUI(pre)) continue;
      if (pre.getAttribute && pre.getAttribute('data-ars-ignore') !== null) continue;
      var text = extractCodeText(pre);
      if (!text || !text.trim()) continue;
      var key = hashContent(text) + ':' + text.length;
      if (seenContent[key]) continue; // doublon exact (ex: re-rendu)
      seenContent[key] = 1;
      var lang = detectLanguage(pre);
      var inf = inferFilename(pre, text, out.length, lang);
      out.push({
        id: 'c' + key.replace(':', ''),
        kind: 'code',
        filename: sanitizeRelPath(inf.name),
        from: inf.from,
        language: lang,
        content: text,
        size: text.length,
        element: pre
      });
    }
    return out;
  }

  function basenameOfUrl(url) {
    try {
      var path = String(url).split('?')[0].split('#')[0];
      var base = path.slice(path.lastIndexOf('/') + 1);
      return base || null;
    } catch (e) { return null; }
  }

  function collectLinkArtifacts(doc) {
    var out = [];
    var seen = {};
    var links = doc.querySelectorAll('a[download]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (isOurUI(a)) continue;
      var href = a.getAttribute('href');
      if (!href || seen[href]) continue;
      seen[href] = 1;
      var name = a.getAttribute('download') || basenameOfUrl(href) || ('arena-piece-jointe-' + pad2(i + 1));
      name = extractFilenameToken(name) || name;
      out.push({
        id: 'l' + hashContent(href),
        kind: 'link',
        filename: sanitizeRelPath(name),
        from: 'link',
        language: null,
        url: href,
        element: a
      });
    }
    return out;
  }

  function collectArtifacts(doc, opts) {
    opts = opts || {};
    var arts = collectCodeArtifacts(doc);
    if (opts.links !== false) arts = arts.concat(collectLinkArtifacts(doc));
    ensureUniqueNames(arts);
    return arts;
  }

  return {
    LANGUAGE_EXT: LANGUAGE_EXT,
    collectArtifacts: collectArtifacts,
    collectCodeArtifacts: collectCodeArtifacts,
    collectLinkArtifacts: collectLinkArtifacts,
    extractCodeText: extractCodeText,
    detectLanguage: detectLanguage,
    inferFilename: inferFilename,
    extractFilenameToken: extractFilenameToken,
    sanitizeRelPath: sanitizeRelPath,
    ensureUniqueNames: ensureUniqueNames,
    hashContent: hashContent
  };
});
