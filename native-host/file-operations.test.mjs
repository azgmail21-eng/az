import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeFileAction, MAX_READ_BYTES, MAX_WRITE_BYTES } from "./file-operations.mjs";
import { resolveDocumentsPath } from "./security.mjs";

async function withDocuments(t, callback) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arena-documents-"));
  const documents = path.join(temporaryRoot, "Documents");
  await fs.mkdir(documents);
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await callback(documents, temporaryRoot);
}

test("résout les chemins uniquement sous Documents", () => {
  const root = path.resolve("/tmp/Documents");
  assert.equal(resolveDocumentsPath(root, "Projet/src/main.py"), path.join(root, "Projet", "src", "main.py"));
  assert.equal(resolveDocumentsPath(root, ".", { allowRoot: true }), root);

  for (const invalid of ["../secret.txt", "Projet/../../secret.txt", "/etc/passwd", "C:\\Windows\\win.ini", "C:secret.txt", "\\\\server\\share\\x.txt"]) {
    assert.throws(() => resolveDocumentsPath(root, invalid), /refusé|relatif/i, invalid);
  }
  assert.throws(() => resolveDocumentsPath(root, "CON.txt"), /non autorisé/i);
  assert.throws(() => resolveDocumentsPath(root, "", { allowRoot: false }), /requis/i);
});

test("crée des dossiers, écrit/lit/liste sans quitter Documents", async (t) => {
  await withDocuments(t, async (documents) => {
    const directory = await executeFileAction(documents, { action: "mkdir", path: "Projet/src" });
    assert.deepEqual(directory, { ok: true, action: "mkdir", path: "Projet/src" });

    const written = await executeFileAction(documents, {
      action: "write",
      path: "Projet/src/main.py",
      content: 'print("bonjour")\n',
    });
    assert.equal(written.ok, true);
    assert.equal(written.path, "Projet/src/main.py");

    const read = await executeFileAction(documents, { action: "read", path: "Projet/src/main.py" });
    assert.equal(read.content, 'print("bonjour")\n');

    const listed = await executeFileAction(documents, { action: "list", path: "Projet/src" });
    assert.equal(listed.path, "Projet/src");
    assert.deepEqual(listed.entries, [{ name: "main.py", type: "file" }]);

    const root = await executeFileAction(documents, { action: "list", path: "." });
    assert.deepEqual(root.entries, [{ name: "Projet", type: "dir" }]);
  });
});

test("remplace un fichier existant dans Documents, mais jamais un chemin hors racine", async (t) => {
  await withDocuments(t, async (documents, temporaryRoot) => {
    await fs.writeFile(path.join(documents, "note.txt"), "ancien", "utf8");
    const result = await executeFileAction(documents, {
      action: "write",
      path: "note.txt",
      content: "nouveau",
    });
    assert.equal(result.ok, true);
    assert.equal(await fs.readFile(path.join(documents, "note.txt"), "utf8"), "nouveau");

    await assert.rejects(
      executeFileAction(documents, { action: "write", path: "../hors-documents.txt", content: "non" }),
      /refusé/i
    );
    await assert.rejects(fs.access(path.join(temporaryRoot, "hors-documents.txt")));
  });
});

test("refuse les liens symboliques et les chemins qui les traversent", async (t) => {
  await withDocuments(t, async (documents, temporaryRoot) => {
    const outside = path.join(temporaryRoot, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "secret.txt"), "secret", "utf8");

    try {
      await fs.symlink(outside, path.join(documents, "raccourci"), "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
        t.skip("La création de liens symboliques n'est pas autorisée sur cette plateforme.");
        return;
      }
      throw error;
    }

    await assert.rejects(
      executeFileAction(documents, { action: "read", path: "raccourci/secret.txt" }),
      /liens symboliques|jonctions|Accès refusé/i
    );
    await assert.rejects(
      executeFileAction(documents, { action: "list", path: "raccourci" }),
      /liens symboliques|jonctions|Accès refusé/i
    );
  });
});

test("refuse aussi les liens physiques vers des fichiers extérieurs", async (t) => {
  await withDocuments(t, async (documents, temporaryRoot) => {
    const outsideFile = path.join(temporaryRoot, "outside-secret.txt");
    await fs.writeFile(outsideFile, "secret", "utf8");
    try {
      await fs.link(outsideFile, path.join(documents, "linked-secret.txt"));
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP", "EXDEV"].includes(error?.code)) {
        t.skip("La création de liens physiques n'est pas prise en charge sur cette plateforme.");
        return;
      }
      throw error;
    }

    await assert.rejects(
      executeFileAction(documents, { action: "read", path: "linked-secret.txt" }),
      /lien physique/i
    );
    await assert.rejects(
      executeFileAction(documents, { action: "write", path: "linked-secret.txt", content: "modifié" }),
      /lien physique/i
    );
    assert.equal(await fs.readFile(outsideFile, "utf8"), "secret");
  });
});

test("limite la taille des fichiers lus et écrits", async (t) => {
  await withDocuments(t, async (documents) => {
    await assert.rejects(
      executeFileAction(documents, { action: "write", path: "trop-grand.txt", content: "x".repeat(MAX_WRITE_BYTES + 1) }),
      /trop volumineux/i
    );

    await fs.writeFile(path.join(documents, "trop-grand.txt"), Buffer.alloc(MAX_READ_BYTES + 1));
    await assert.rejects(
      executeFileAction(documents, { action: "read", path: "trop-grand.txt" }),
      /trop volumineux/i
    );
  });
});

test("ne propose aucune suppression de fichier", async (t) => {
  await withDocuments(t, async (documents) => {
    await fs.writeFile(path.join(documents, "keep.txt"), "important", "utf8");
    await assert.rejects(executeFileAction(documents, { action: "delete", path: "keep.txt" }), /inconnue/i);
    assert.equal(await fs.readFile(path.join(documents, "keep.txt"), "utf8"), "important");
  });
});
