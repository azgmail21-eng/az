#!/usr/bin/env node
// Arena Auto Native — host de messagerie native VERROUILLÉ sur Documents.
// Protocole Chrome Native Messaging (stdin/stdout, longueur sur 4 octets LE).
// Aucun service permanent : Edge lance ce script à chaque action, reçoit la
// réponse, puis le termine.
//
// CONTRAT DE SÉCURITÉ (non configurable, codé en dur) :
// - Tous les chemins sont relatifs à %USERPROFILE%\Documents, point final.
// - Refusés : "..", chemins absolus, lettres de lecteur (C:...), schémas.
// - Actions : ping, read, list, mkdir, write. PAS de suppression.
// La variable d'environnement ARENA_AUTO_DOCS permet de rediriger le dossier
// (réservé aux tests automatisés).

import fs from "node:fs/promises";
import path from "node:path";

const BASE_DIR =
  process.env.ARENA_AUTO_DOCS ||
  path.join(process.env.USERPROFILE || process.env.HOME || ".", "Documents");

const MAX_READ = 512 * 1024; // le canal natif est limité à ~1 Mo par message
const MAX_LIST = 500;
const MAX_WRITE = 900 * 1024;
const MAX_PATH = 500;

// Résout un chemin relatif DANS Documents, ou lance une erreur sinon.
function resolveInside(rel) {
  if (typeof rel !== "string") throw new Error("Chemin manquant.");
  const s = rel.replace(/\\/g, "/").trim();
  if (s === "" || s === "." || s === "./") return path.resolve(BASE_DIR);
  if (s.length > MAX_PATH) throw new Error("Chemin trop long.");
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
    throw new Error("Chemin absolu ou lettre de lecteur refusé (relatif à Documents uniquement).");
  }
  if (s.startsWith("/")) {
    throw new Error("Chemin absolu refusé (relatif à Documents uniquement).");
  }
  const target = path.resolve(BASE_DIR, s);
  const base = path.resolve(BASE_DIR);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("Chemin en dehors de Documents : accès refusé.");
  }
  return target;
}

// ---- Protocole : lecture d'un message ----
function readMessage() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let expectedLength = null;

    function onData(chunk) {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      if (expectedLength === null && buf.length >= 4) {
        expectedLength = buf.readUInt32LE(0);
      }
      if (expectedLength !== null && buf.length >= 4 + expectedLength) {
        process.stdin.removeListener("data", onData);
        const body = buf.slice(4, 4 + expectedLength).toString("utf-8");
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      }
    }

    process.stdin.on("data", onData);
    process.stdin.on("end", () => {
      if (chunks.length === 0) resolve(null);
    });
  });
}

// ---- Protocole : écriture d'une réponse ----
// IMPORTANT : on attend la fin du flush avant de quitter, sinon process.exit()
// tronque les grosses réponses (stdout sur pipe = écriture asynchrone).
function sendMessage(obj) {
  return new Promise((resolve) => {
    const json = Buffer.from(JSON.stringify(obj), "utf-8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(json.length, 0);
    process.stdout.write(Buffer.concat([header, json]), () => resolve());
  });
}

// ---- Actions ----
async function handle(msg) {
  await fs.mkdir(BASE_DIR, { recursive: true });

  switch (msg.action) {
    case "ping":
      return { ok: true, baseDir: BASE_DIR };

    case "list": {
      const dir = resolveInside(msg.path || ".");
      let dirents;
      try {
        dirents = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return { ok: false, error: `Dossier introuvable : ${msg.path || "."}` };
      }
      const entries = dirents
        .map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }))
        .sort((a, b) =>
          a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name)
        );
      const truncated = entries.length > MAX_LIST;
      return { ok: true, entries: entries.slice(0, MAX_LIST), truncated };
    }

    case "read": {
      if (!msg.path || !String(msg.path).trim()) {
        return { ok: false, error: "Chemin de fichier vide." };
      }
      const filePath = resolveInside(msg.path);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat) return { ok: false, error: `Fichier introuvable : ${msg.path}` };
      if (!stat.isFile()) {
        return { ok: false, error: `${msg.path} n'est pas un fichier (utilise list).` };
      }
      const size = Math.min(stat.size, MAX_READ);
      const fh = await fs.open(filePath, "r");
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, 0);
      await fh.close();
      return { ok: true, content: buf.toString("utf-8"), truncated: stat.size > MAX_READ };
    }

    case "mkdir": {
      if (!msg.path || !String(msg.path).trim()) {
        return { ok: false, error: "Chemin vide." };
      }
      const dirPath = resolveInside(msg.path);
      await fs.mkdir(dirPath, { recursive: true });
      return { ok: true, path: dirPath };
    }

    case "write": {
      if (!msg.path || !String(msg.path).trim()) {
        return { ok: false, error: "Chemin de fichier vide." };
      }
      const content = msg.content ?? "";
      const bytes = Buffer.byteLength(content, "utf-8");
      if (bytes > MAX_WRITE) {
        return { ok: false, error: `Fichier trop gros (${Math.round(bytes / 1024)} Ko > ${Math.round(MAX_WRITE / 1024)} Ko), découpe-le en plusieurs fichiers.` };
      }
      const filePath = resolveInside(msg.path);
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat && stat.isDirectory()) {
        return { ok: false, error: `${msg.path} est un dossier, impossible d'y écrire directement.` };
      }
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return { ok: true, path: filePath, bytesWritten: bytes };
    }

    default:
      return { ok: false, error: `Action inconnue : ${msg.action} (ping, read, list, mkdir, write).` };
  }
}

// ---- Boucle principale (un message par lancement) ----
(async () => {
  try {
    const msg = await readMessage();
    if (msg === null) process.exit(0);
    const result = await handle(msg);
    await sendMessage(result);
  } catch (err) {
    await sendMessage({ ok: false, error: String(err && err.message ? err.message : err) });
  }
  process.exit(0);
})();
