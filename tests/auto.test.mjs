import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const FS = require('../arena-auto/autofs.js');

console.log('Tests ArenaAutoFS :');

// 1. WRITE complet
{
  const req = FS.parseActionBlock('WRITE: projet/app.py\n---\nprint("héllo")\nligne2');
  assert.equal(req.type, 'write');
  assert.equal(req.path, 'projet/app.py');
  assert.equal(req.content, 'print("héllo")\nligne2');
  console.log('  ✅ WRITE complet parsé (contenu exact)');
}

// 2. WRITE sans séparateur => invalide
{
  const req = FS.parseActionBlock('WRITE: a.py\nprint(1)');
  assert.equal(req.type, 'invalid');
  console.log('  ✅ WRITE sans --- => invalide');
}

// 3. WRITE en cours de frappe => incomplet
{
  assert.equal(FS.parseActionBlock('WRITE: a.py').type, 'incomplete');
  assert.equal(FS.parseActionBlock('WRITE: a.py\n').type, 'incomplete');
  console.log('  ✅ WRITE partiel => incomplet (réessayé plus tard)');
}

// 4. ACTION read/list/mkdir (insensible à la casse et aux espaces)
{
  const r = FS.parseActionBlock('action: READ\npath: docs/note.md');
  assert.deepEqual([r.type, r.action, r.path], ['action', 'read', 'docs/note.md']);
  const l = FS.parseActionBlock('ACTION:list\nPATH: .');
  assert.deepEqual([l.type, l.action, l.path], ['action', 'list', '.']);
  const m = FS.parseActionBlock('  Action:  Mkdir  \n  Path:  projet/src  ');
  assert.deepEqual([m.type, m.action, m.path], ['action', 'mkdir', 'projet/src']);
  console.log('  ✅ ACTION read/list/mkdir parsées');
}

// 5. ACTION inconnue => invalide ; PATH manquant => incomplet
{
  assert.equal(FS.parseActionBlock('ACTION: delete\nPATH: a').type, 'invalid');
  assert.equal(FS.parseActionBlock('ACTION: read').type, 'incomplete');
  console.log('  ✅ ACTION inconnue => invalide, PATH manquant => incomplet');
}

// 6. Texte normal => null (pas un bloc d'action)
{
  assert.equal(FS.parseActionBlock('print("hello")'), null);
  assert.equal(FS.parseActionBlock('Voici le fichier WRITE: test'), null);
  assert.equal(FS.parseActionBlock(''), null);
  console.log('  ✅ texte normal ignoré (null)');
}

// 7. Sandbox : chemins relatifs acceptés
{
  assert.deepEqual(FS.resolveInside('projet/app.py'), ['projet', 'app.py']);
  assert.deepEqual(FS.resolveInside('mon fichier (2).py'), ['mon fichier (2).py']);
  assert.deepEqual(FS.resolveInside('a/b/c/'), ['a', 'b', 'c']);
  assert.deepEqual(FS.resolveInside('.'), []);
  assert.deepEqual(FS.resolveInside(''), []);
  console.log('  ✅ chemins relatifs acceptés');
}

// 8. Sandbox : refus des échappées
{
  for (const bad of ['../secret.txt', 'a/../../x', '..', 'C:\\Users\\moi\\f.txt',
    'C:/Users/moi/f.txt', 'a:b.py', '/etc/passwd', 'file:///x']) {
    assert.equal(FS.resolveInside(bad), null, `refusé : ${bad}`);
  }
  console.log('  ✅ échappées refusées (.., C:, /, file:)');
}

// 9. Sandbox : sanitisation des segments
{
  assert.deepEqual(FS.resolveInside('docs/mon:fichier?.py'), ['docs', 'mon_fichier_.py']);
  assert.deepEqual(FS.resolveInside('CON.txt'), ['_CON.txt']);
  assert.deepEqual(FS.resolveInside('dossier\\fichier.py'), ['dossier', 'fichier.py']);
  console.log('  ✅ sanitisation Windows des segments');
}

// 10. formatResult : les 4 cas OK + erreur
{
  const w = FS.formatResult({ type: 'write', path: 'a.py' }, { ok: true, bytes: 12 });
  assert.ok(w.includes('write a.py : OK') && w.includes('12 octets'));
  const r = FS.formatResult({ type: 'action', action: 'read', path: 'a.py' }, { ok: true, content: 'X' });
  assert.ok(r.includes('read a.py') && r.includes('X'));
  const l = FS.formatResult({ type: 'action', action: 'list', path: '.' },
    { ok: true, entries: [{ name: 'd', type: 'dir' }, { name: 'f', type: 'file' }] });
  assert.ok(l.includes('[DIR]  d') && l.includes('[FILE] f'));
  const le = FS.formatResult({ type: 'action', action: 'list', path: '.' }, { ok: true, entries: [] });
  assert.ok(le.includes('(dossier vide)'));
  const mk = FS.formatResult({ type: 'action', action: 'mkdir', path: 'd' }, { ok: true });
  assert.ok(mk.includes('mkdir d : OK'));
  const ko = FS.formatResult({ type: 'action', action: 'read', path: 'x' }, { ok: false, error: 'nope' });
  assert.ok(ko.includes('ERREUR') && ko.includes('nope'));
  console.log('  ✅ formatResult (write/read/list/mkdir/erreur)');
}

// 11. truncate
{
  assert.deepEqual(FS.truncate('abc', 10), { text: 'abc', cut: false });
  assert.deepEqual(FS.truncate('abcdef', 3), { text: 'abc', cut: true });
  console.log('  ✅ truncate');
}

console.log('\nTous les tests passent ✅');
