#!/usr/bin/env node
// Native Messaging Host - "DeepSeek Local File Bridge"
// Lu/écrit par le navigateur via stdin/stdout selon le protocole Chrome Native Messaging.
// Ce process n'est lancé QUE le temps d'un appel : le navigateur le démarre, envoie un
// message, reçoit la réponse, puis le termine (aucun service en tâche de fond permanent).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.json");

// ---- Lecture de la configuration ----
async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      unrestricted: false,
      baseDir: path.join(process.env.USERPROFILE || process.env.HOME || ".", "DeepSeekFiles"),
    };
  }
}

// Dossiers système protégés même en mode "unrestricted" (filet de sécurité minimal)
const PROTECTED_PREFIXES = [
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\ProgramData",
];

function assertNotProtected(target) {
  const lower = target.toLowerCase();
  for (const p of PROTECTED_PREFIXES) {
    if (lower.startsWith(p.toLowerCase())) {
      throw new Error(`Accès refusé : ${p} est protégé même en mode illimité.`);
    }
  }
}

// ---- Résolution du chemin : mode restreint (dossier unique) ou illimité (tout le disque) ----
function resolveSafePath(config, relOrAbsPath) {
  if (config.unrestricted) {
    // En mode illimité, on accepte les chemins absolus (ex: "C:\Users\remi\Documents\x.txt")
    // ou relatifs (résolus depuis le dossier utilisateur par défaut).
    const target = path.isAbsolute(relOrAbsPath)
      ? path.resolve(relOrAbsPath)
      : path.resolve(process.env.USERPROFILE || ".", relOrAbsPath || ".");
    assertNotProtected(target);
    return target;
  }

  const baseDir = config.baseDir;
  const target = path.resolve(baseDir, relOrAbsPath || ".");
  const base = path.resolve(baseDir);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("Chemin en dehors du dossier autorisé.");
  }
  return target;
}

// ---- Protocole Native Messaging : lire un message (préfixe de longueur 4 octets, little-endian) ----
function readMessage() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let expectedLength = null;
    let received = 0;

    function onData(chunk) {
      chunks.push(chunk);
      received += chunk.length;
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
      if (chunks.length === 0) resolve(null); // rien reçu, on quitte proprement
    });
  });
}

// ---- Écrire une réponse au navigateur ----
function sendMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}

// ---- Exécution d'une commande ----
async function handle(msg) {
  const config = await loadConfig();
  if (!config.unrestricted) {
    await fs.mkdir(config.baseDir, { recursive: true });
  }

  switch (msg.action) {
    case "ping":
      return { ok: true, unrestricted: !!config.unrestricted, baseDir: config.baseDir };

    case "list": {
      const dir = resolveSafePath(config, msg.path || ".");
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return {
        ok: true,
        dir,
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : "file",
        })),
      };
    }

    case "read": {
      const filePath = resolveSafePath(config, msg.path);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat) return { ok: false, error: `Introuvable : ${filePath}` };
      if (stat.isDirectory()) {
        return { ok: false, error: `${filePath} est un dossier, pas un fichier. Utilise "Lister" à la place.` };
      }
      const content = await fs.readFile(filePath, "utf-8");
      return { ok: true, path: filePath, content };
    }

    case "mkdir": {
      const dirPath = resolveSafePath(config, msg.path);
      await fs.mkdir(dirPath, { recursive: true });
      return { ok: true, path: dirPath };
    }

    case "write": {
      const filePath = resolveSafePath(config, msg.path);
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat && stat.isDirectory()) {
        return { ok: false, error: `${filePath} est un dossier, impossible d'y écrire directement.` };
      }
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, msg.content ?? "", "utf-8");
      return { ok: true, path: filePath, bytesWritten: Buffer.byteLength(msg.content ?? "") };
    }

    default:
      return { ok: false, error: `Action inconnue: ${msg.action}` };
  }
}

// ---- Boucle principale ----
(async () => {
  try {
    const msg = await readMessage();
    if (msg === null) process.exit(0);
    const result = await handle(msg);
    sendMessage(result);
  } catch (err) {
    sendMessage({ ok: false, error: String(err && err.message ? err.message : err) });
  }
  process.exit(0);
})();
