import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOST = path.join(here, '..', 'arena-auto-host', 'host.mjs');

console.log('Tests ArenaAutoHost :');

// 0. autofs.js synchronisé entre arena-auto/ et arena-auto-native/
{
  const a = fs.readFileSync(path.join(here, '..', 'arena-auto', 'autofs.js'));
  const b = fs.readFileSync(path.join(here, '..', 'arena-auto-native', 'autofs.js'));
  assert.ok(a.equals(b), 'autofs.js doit être identique dans les deux extensions');
  console.log('  ✅ autofs.js synchronisé entre les deux extensions');
}

// Dossier temporaire jouant le rôle de "Documents" (jamais les vrais Documents).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-docs-'));

function call(msg) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOST], {
      env: { ...process.env, ARENA_AUTO_DOCS: tmp },
    });
    const body = Buffer.from(JSON.stringify(msg), 'utf8');
    const frame = Buffer.concat([Buffer.alloc(4), body]);
    frame.writeUInt32LE(body.length, 0);
    let out = Buffer.alloc(0);
    child.stdout.on('data', (c) => { out = Buffer.concat([out, c]); });
    child.on('error', reject);
    child.on('close', () => {
      try {
        assert.ok(out.length >= 4, 'réponse trop courte');
        const len = out.readUInt32LE(0);
        assert.ok(out.length >= 4 + len, 'trame incomplète');
        resolve(JSON.parse(out.slice(4, 4 + len).toString('utf8')));
      } catch (e) {
        reject(new Error(`réponse host illisible : ${e.message} / stdout=${JSON.stringify(out.toString('utf8').slice(0, 300))}`));
      }
    });
    child.stdin.write(frame);
    child.stdin.end();
  });
}

// 1. ping
{
  const r = await call({ action: 'ping' });
  assert.equal(r.ok, true);
  assert.equal(r.baseDir, tmp);
  console.log('  ✅ ping (baseDir = dossier de test)');
}

// 2. mkdir + list
{
  const m = await call({ action: 'mkdir', path: 'projet/src' });
  assert.equal(m.ok, true);
  assert.ok(fs.existsSync(path.join(tmp, 'projet', 'src')));
  const l = await call({ action: 'list', path: 'projet' });
  assert.equal(l.ok, true);
  assert.deepEqual(l.entries, [{ name: 'src', type: 'dir' }]);
  console.log('  ✅ mkdir + list');
}

// 3. write + read (aller-retour exact)
{
  const content = 'print("héllo 👋")\nligne2\n';
  const w = await call({ action: 'write', path: 'projet/app.py', content });
  assert.equal(w.ok, true);
  assert.equal(w.bytesWritten, Buffer.byteLength(content));
  const r = await call({ action: 'read', path: 'projet/app.py' });
  assert.equal(r.ok, true);
  assert.equal(r.content, content);
  assert.equal(r.truncated, false);
  console.log('  ✅ write + read (contenu exact, unicode OK)');
}

// 4. write crée les dossiers parents
{
  const w = await call({ action: 'write', path: 'a/b/c.txt', content: 'x' });
  assert.equal(w.ok, true);
  assert.equal(fs.readFileSync(path.join(tmp, 'a', 'b', 'c.txt'), 'utf8'), 'x');
  console.log('  ✅ write crée les dossiers parents');
}

// 5. Sandbox : toutes les échappées refusées, rien créé hors du dossier
{
  for (const bad of ['../evil.txt', '..\\evil.txt', 'a/../../evil.txt', '..',
    'C:\\Windows\\evil.txt', 'C:/Windows/evil.txt', '/tmp/evil.txt', 'file:///x']) {
    const r = await call({ action: 'write', path: bad, content: 'pwned' });
    assert.equal(r.ok, false, `refusé : ${bad}`);
  }
  const r = await call({ action: 'list', path: '..' });
  assert.equal(r.ok, false);
  assert.ok(!fs.existsSync(path.join(path.dirname(tmp), 'evil.txt')), 'rien écrit hors du dossier');
  assert.ok(!fs.existsSync('/tmp/evil.txt'), 'rien écrit dans /tmp');
  console.log('  ✅ échappées refusées (.., C:, /, file:) + disque intact');
}

// 6. Cas d'erreur propres
{
  assert.equal((await call({ action: 'read', path: 'nope.txt' })).ok, false);
  assert.equal((await call({ action: 'list', path: 'nope' })).ok, false);
  assert.equal((await call({ action: 'read', path: 'projet' })).ok, false); // dossier, pas fichier
  assert.equal((await call({ action: 'write', path: '', content: 'x' })).ok, false);
  assert.equal((await call({ action: 'delete', path: 'x' })).ok, false); // pas d'action delete
  assert.equal((await call({ action: 'nimportequoi' })).ok, false);
  console.log('  ✅ erreurs propres (manquant, dossier, vide, delete refusé)');
}

// 7. Gros fichier : write 600 Ko OK, read tronqué à 512 Ko
{
  const big = 'a'.repeat(600 * 1024);
  const w = await call({ action: 'write', path: 'big.txt', content: big });
  assert.equal(w.ok, true);
  const r = await call({ action: 'read', path: 'big.txt' });
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(r.content.length, 512 * 1024);
  const tooBig = await call({ action: 'write', path: 'toobig.txt', content: 'b'.repeat(950 * 1024) });
  assert.equal(tooBig.ok, false);
  console.log('  ✅ limites de taille (write 600K OK, read tronqué, write 950K refusé)');
}

// 8. Liste tronquée à 500 entrées
{
  fs.mkdirSync(path.join(tmp, 'foule'), { recursive: true });
  for (let i = 0; i < 600; i++) fs.writeFileSync(path.join(tmp, 'foule', `f${i}.txt`), 'x');
  const l = await call({ action: 'list', path: 'foule' });
  assert.equal(l.ok, true);
  assert.equal(l.entries.length, 500);
  assert.equal(l.truncated, true);
  console.log('  ✅ liste tronquée à 500 entrées');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nTous les tests passent ✅');
