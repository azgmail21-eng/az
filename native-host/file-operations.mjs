import fs from "node:fs/promises";
import path from "node:path";
import { isInsideDirectory, resolveDocumentsPath } from "./security.mjs";

export const MAX_READ_BYTES = 128 * 1024;
export const MAX_WRITE_BYTES = 512 * 1024;
const MAX_LIST_ENTRIES = 500;

function displayPath(root, target) {
  const relative = path.relative(root, target);
  return relative ? relative.split(path.sep).join("/") : ".";
}

function isMissing(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Refuse symlinks/junctions and hard-linked files below the authorized root. */
async function assertSafeComponents(root, target) {
  if (!isInsideDirectory(root, target)) {
    throw new Error("Chemin refusé : la sortie du dossier Documents n'est pas autorisée.");
  }

  const relative = path.relative(root, target);
  if (!relative) return;

  let current = root;
  const segments = relative.split(path.sep).filter(Boolean);

  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const stat = await lstatOrNull(current);
    if (!stat) return; // Les segments suivants ne peuvent pas encore exister.

    if (stat.isSymbolicLink()) {
      throw new Error("Accès refusé : les liens symboliques et jonctions ne sont pas autorisés dans Documents.");
    }
    if (stat.isFile() && stat.nlink > 1) {
      throw new Error("Accès refusé : ce fichier est un lien physique vers un autre emplacement.");
    }

    const realPath = await fs.realpath(current);
    if (!isInsideDirectory(root, realPath)) {
      throw new Error("Accès refusé : ce chemin pointe hors du dossier Documents.");
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`${displayPath(root, current)} n'est pas un dossier.`);
    }
  }
}

async function ensureDirectories(root, targetDirectory) {
  if (!isInsideDirectory(root, targetDirectory)) {
    throw new Error("Chemin refusé : la sortie du dossier Documents n'est pas autorisée.");
  }

  const relative = path.relative(root, targetDirectory);
  if (!relative) return;

  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      await fs.mkdir(current);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Accès refusé : ${displayPath(root, current)} n'est pas un dossier sûr.`);
    }

    const realPath = await fs.realpath(current);
    if (!isInsideDirectory(root, realPath)) {
      throw new Error("Accès refusé : ce chemin pointe hors du dossier Documents.");
    }
  }
}

function validateMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new Error("Commande invalide.");
  }
  if (typeof message.action !== "string") {
    throw new Error("Action manquante.");
  }
}

/** Execute one supported operation, always below the real Documents directory. */
export async function executeFileAction(documentsRoot, message) {
  validateMessage(message);
  const root = await fs.realpath(documentsRoot);

  if (message.action === "ping") {
    return { ok: true, action: "ping", root: "Documents" };
  }

  const action = message.action.toLowerCase();
  if (!["list", "read", "mkdir", "write"].includes(action)) {
    throw new Error(`Action inconnue : ${message.action}`);
  }

  const target = resolveDocumentsPath(root, message.path, {
    allowRoot: action === "list" || action === "mkdir",
  });

  if (action === "list") {
    await assertSafeComponents(root, target);
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      throw new Error(`${displayPath(root, target)} n'est pas un dossier.`);
    }

    const allEntries = await fs.readdir(target, { withFileTypes: true });
    const entries = allEntries.slice(0, MAX_LIST_ENTRIES).map((entry) => ({
      name: entry.name,
      type: entry.isSymbolicLink() ? "link" : entry.isDirectory() ? "dir" : "file",
    }));

    return {
      ok: true,
      action,
      path: displayPath(root, target),
      entries,
      truncated: allEntries.length > entries.length,
    };
  }

  if (action === "read") {
    await assertSafeComponents(root, target);
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      throw new Error(`${displayPath(root, target)} est un dossier, pas un fichier.`);
    }
    if (!stat.isFile()) {
      throw new Error("Seuls les fichiers ordinaires peuvent être lus.");
    }
    if (stat.size > MAX_READ_BYTES) {
      throw new Error(`Fichier trop volumineux (limite : ${MAX_READ_BYTES} octets).`);
    }

    const content = await fs.readFile(target, "utf8");
    return { ok: true, action, path: displayPath(root, target), content };
  }

  if (action === "mkdir") {
    await ensureDirectories(root, target);
    return { ok: true, action, path: displayPath(root, target) };
  }

  if (typeof message.content !== "string") {
    throw new Error("Le contenu du fichier doit être du texte.");
  }
  if (Buffer.byteLength(message.content, "utf8") > MAX_WRITE_BYTES) {
    throw new Error(`Contenu trop volumineux (limite : ${MAX_WRITE_BYTES} octets).`);
  }

  await ensureDirectories(root, path.dirname(target));
  await assertSafeComponents(root, target);
  const existing = await lstatOrNull(target);
  if (existing?.isDirectory()) {
    throw new Error(`${displayPath(root, target)} est un dossier, impossible d'y écrire.`);
  }
  if (existing && !existing.isFile()) {
    throw new Error("Seuls les fichiers ordinaires peuvent être remplacés.");
  }
  if (existing?.nlink > 1) {
    throw new Error("Accès refusé : ce fichier est un lien physique vers un autre emplacement.");
  }

  // L'écriture remplace un fichier existant, mais reste limitée à Documents.
  await fs.writeFile(target, message.content, { encoding: "utf8", mode: 0o600 });
  await assertSafeComponents(root, target);

  return {
    ok: true,
    action,
    path: displayPath(root, target),
    bytesWritten: Buffer.byteLength(message.content, "utf8"),
  };
}
