import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const detectSrc = readFileSync(join(here, '..', 'arena-extension', 'detect.js'), 'utf8');

function setup(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
    runScripts: 'outside-only' // autorise window.eval() dans le contexte jsdom
  });
  dom.window.eval(detectSrc);
  return { D: dom.window.ArenaDetect, document: dom.window.document };
}

console.log('Tests ArenaDetect :');

// 1. Nom trouvé dans l'en-tête du bloc
{
  const { D, document } = setup(`
    <div class="code-block">
      <div class="code-header"><span>app.py</span><button>Copier</button></div>
      <pre><code class="language-python">print("hello")</code></pre>
    </div>`);
  const arts = D.collectArtifacts(document);
  assert.equal(arts.length, 1);
  assert.equal(arts[0].filename, 'app.py');
  assert.equal(arts[0].language, 'python');
  assert.equal(arts[0].content, 'print("hello")');
  console.log('  ✅ filename depuis le header du bloc');
}

// 2. Première ligne en commentaire
{
  const { D, document } = setup(`
    <pre><code class="language-javascript">// server.js
console.log(1);</code></pre>`);
  const arts = D.collectArtifacts(document);
  assert.equal(arts.length, 1);
  assert.equal(arts[0].filename, 'server.js');
  assert.equal(arts[0].from, 'comment');
  console.log('  ✅ filename depuis la première ligne commentée');
}

// 3. Attribut data-filename avec sous-dossier
{
  const { D, document } = setup(`
    <pre data-filename="src/utils/helpers.ts"><code>export const x = 1;</code></pre>`);
  const arts = D.collectArtifacts(document);
  assert.equal(arts.length, 1);
  assert.equal(arts[0].filename, 'src/utils/helpers.ts');
  console.log('  ✅ filename depuis data-filename (avec sous-dossier)');
}

// 4. Fallback numéroté avec la bonne extension
{
  const { D, document } = setup(`
    <pre><code class="language-rust">fn main() {}</code></pre>`);
  const arts = D.collectArtifacts(document);
  assert.equal(arts.length, 1);
  assert.equal(arts[0].filename, 'arena-rust-01.rs');
  assert.equal(arts[0].from, 'fallback');
  console.log('  ✅ fallback numéroté avec extension du langage');
}

// 5. Boutons / numéros de ligne exclus du contenu
{
  const { D, document } = setup(`
    <pre><button>Copier</button><code><span class="line-number">1</span><span>x = 1</span>
<span class="line-number">2</span><span>y = 2</span></code></pre>`);
  const arts = D.collectArtifacts(document);
  assert.equal(arts.length, 1);
  assert.ok(!arts[0].content.includes('Copier'), 'bouton exclu');
  assert.ok(!/[12]\s*x = 1/.test(arts[0].content), 'numéros exclus: ' + JSON.stringify(arts[0].content));
  assert.ok(arts[0].content.includes('x = 1') && arts[0].content.includes('y = 2'));
  console.log('  ✅ boutons et numéros de ligne exclus du contenu');
}

// 6. Doublons exacts fusionnés
{
  const { D, document } = setup(`
    <pre><code>same</code></pre><pre><code>same</code></pre><pre><code>other</code></pre>`);
  const arts = D.collectArtifacts(document);
  assert.equal(arts.length, 2);
  console.log('  ✅ doublons exacts fusionnés');
}

// 7. Même nom, contenus différents => suffixe (2)
{
  const { D, document } = setup(`
    <div><div class="file-title">app.py</div><pre><code>v1</code></pre></div>
    <div><div class="file-title">app.py</div><pre><code>v2</code></pre></div>`);
  const arts = D.collectArtifacts(document);
  assert.equal(arts.length, 2);
  assert.equal(arts[0].filename, 'app.py');
  assert.equal(arts[1].filename, 'app (2).py');
  console.log('  ✅ collision de noms => suffixe (2)');
}

// 8. Liens <a download> détectés comme pièces jointes
{
  const { D, document } = setup(`
    <a href="https://arena.ai/files/rapport.pdf" download="rapport.pdf">Télécharger</a>
    <pre><code>code</code></pre>`);
  const arts = D.collectArtifacts(document);
  assert.equal(arts.length, 2);
  const link = arts.find((a) => a.kind === 'link');
  assert.ok(link);
  assert.equal(link.filename, 'rapport.pdf');
  console.log('  ✅ liens <a download> détectés');
}

// 9. Sanitisation Windows (caractères interdits, .., CON)
{
  const { D } = setup(``);
  assert.equal(D.sanitizeRelPath('..\\..\\secret\\a:b?.txt'), 'secret/a_b_.txt');
  assert.equal(D.sanitizeRelPath('CON.txt'), '_CON.txt');
  assert.equal(D.sanitizeRelPath('  '), 'arena-fichier.txt');
  console.log('  ✅ sanitisation des chemins Windows');
}

// 10. Le panneau de l'extension est ignoré
{
  const { D, document } = setup(`
    <div id="ars-panel"><pre><code>notre UI</code></pre></div>
    <pre><code>vrai code</code></pre>`);
  const arts = D.collectArtifacts(document);
  assert.equal(arts.length, 1);
  assert.equal(arts[0].content, 'vrai code');
  console.log('  ✅ le panneau de l’extension est ignoré');
}

// 11. Pas de faux positif sur une ligne de commentaire normale
{
  const { D, document } = setup(`
    <pre><code class="language-python"># Fichier principal de l'application
print(1)</code></pre>`);
  const arts = D.collectArtifacts(document);
  assert.equal(arts.length, 1);
  assert.equal(arts[0].from, 'fallback');
  console.log('  ✅ pas de faux positif sur commentaire normal');
}

console.log('\nTous les tests passent ✅');
