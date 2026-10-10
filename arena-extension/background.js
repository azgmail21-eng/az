// Arena FS — service worker d'arrière-plan.
// Toutes les opérations de fichiers passent ici et restent STRICTEMENT
// cantonnées au dossier choisi par l'utilisateur (typiquement « Documents ») :
//   - aucun chemin absolu accepté,
//   - « .. » interdit (impossible de remonter hors du dossier),
//   - chaque segment de chemin est validé.

import { loadRootHandle, clearRootHandle } from "./db.js";

const MAX_BASE64 = 60_000_000; // ~45 Mo de données une fois décodé

/* ---------------- Autorisations ---------------- */

async function getRoot() {
  const root = await loadRootHandle();
  if (!root) {
    throw new Error(
      "Aucun dossier connecté. Cliquez sur l'icône de l'extension Arena FS pour choisir votre dossier Documents."
    );
  }
  let perm;
  try {
    perm = await root.queryPermission({ mode: "readwrite" });
  } catch {
    perm = "denied";
  }
  if (perm !== "granted") {
    // Après le premier choix du dossier, la permission reste accordée :
    // cet appel se résout alors tout seul, sans aucune fenêtre.
    try {
      perm = await root.requestPermission({ mode: "readwrite" });
    } catch {
      perm = "denied";
    }
  }
  if (perm !== "granted") {
    throw new Error(
      "Permission non accordée sur le dossier. Reconnectez-le depuis le popup de l'extension."
    );
  }
  return root;
}

/* ---------------- Chemins ---------------- */

function parsePath(path, { allowEmpty = false } = {}) {
  const raw = String(path ?? "").trim();
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\")) {
    throw new Error(
      "Les chemins absolus ne sont pas autorisés : tout est relatif au dossier connecté."
    );
  }
  const segments = raw.split(/[\\/]+/).filter((p) => p !== "" && p !== ".");
  if (segments.some((s) => s === "..")) {
    throw new Error(
      "Chemin refusé : « .. » est interdit (impossible de sortir du dossier autorisé)."
    );
  }
  if (!allowEmpty && segments.length === 0) {
    throw new Error("Chemin manquant.");
  }
  return segments;
}

function validateSegment(name) {
  if (!name || name.length > 150) {
    throw new Error(`Nom invalide : « ${name} ».`);
  }
  if (/[<>:"|?*\u0000-\u001f]/.test(name)) {
    throw new Error(`Nom invalide (caractères interdits) : « ${name} ».`);
  }
}

async function resolveDir(root, segments, create) {
  let dir = root;
  for (const seg of segments) {
    validateSegment(seg);
    dir = await dir.getDirectoryHandle(seg, { create });
  }
  return dir;
}

function pathString(segments) {
  return segments.length ? "/" + segments.join("/") : "/";
}

/* ---------------- Opérations ---------------- */

async function opStatus() {
  const root = await loadRootHandle();
  if (!root) return { connected: false };
  let permission = "unknown";
  try {
    permission = await root.queryPermission({ mode: "readwrite" });
  } catch {
    /* ignore */
  }
  return { connected: true, name: root.name, permission };
}

async function opWrite(msg) {
  const root = await getRoot();
  const segments = parsePath(msg.path);
  const fileName = segments[segments.length - 1];
  validateSegment(fileName);
  const dir = await resolveDir(root, segments.slice(0, -1), true); // crée les dossiers au passage
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  let bytes;
  if (msg.encoding === "base64") {
    const b64 = String(msg.content || "");
    if (b64.length > MAX_BASE64) {
      throw new Error("Fichier trop volumineux pour le pont (max ~45 Mo).");
    }
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    bytes = arr.length;
    await writable.write(arr);
  } else {
    const text = typeof msg.content === "string" ? msg.content : String(msg.content ?? "");
    bytes = new TextEncoder().encode(text).length;
    await writable.write(text);
  }
  await writable.close();
  return { path: pathString(segments), bytes };
}

async function opRead(msg) {
  const root = await getRoot();
  const segments = parsePath(msg.path);
  const dir = await resolveDir(root, segments.slice(0, -1), false);
  const fileHandle = await dir.getFileHandle(segments[segments.length - 1]);
  const file = await fileHandle.getFile();
  if (msg.encoding === "base64") {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
    }
    return { path: pathString(segments), size: file.size, base64: btoa(bin) };
  }
  return { path: pathString(segments), size: file.size, content: await file.text() };
}

async function opMkdir(msg) {
  const root = await getRoot();
  const segments = parsePath(msg.path);
  await resolveDir(root, segments, true);
  return { path: pathString(segments) };
}

async function opList(msg) {
  const root = await getRoot();
  const segments = parsePath(msg.path ?? "", { allowEmpty: true });
  const dir = await resolveDir(root, segments, false);
  const entries = [];
  for await (const entry of dir.values()) {
    entries.push({ name: entry.name, kind: entry.kind });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { path: pathString(segments), entries };
}

async function opExists(msg) {
  const root = await getRoot();
  const segments = parsePath(msg.path ?? "", { allowEmpty: true });
  const target = pathString(segments);
  if (segments.length === 0) return { path: "/", exists: true, kind: "directory" };
  const name = segments[segments.length - 1];
  let parent;
  try {
    parent = await resolveDir(root, segments.slice(0, -1), false);
  } catch {
    return { path: target, exists: false };
  }
  try {
    await parent.getFileHandle(name);
    return { path: target, exists: true, kind: "file" };
  } catch {
    /* pas un fichier */
  }
  try {
    await parent.getDirectoryHandle(name);
    return { path: target, exists: true, kind: "directory" };
  } catch {
    return { path: target, exists: false };
  }
}

async function opRemove(msg) {
  const root = await getRoot();
  const segments = parsePath(msg.path);
  const dir = await resolveDir(root, segments.slice(0, -1), false);
  const name = segments[segments.length - 1];
  await dir.removeEntry(name, { recursive: msg.recursive !== false });
  return { removed: pathString(segments) };
}

async function opClear() {
  await clearRootHandle();
  return { cleared: true };
}

/* ---------------- Routage des messages ---------------- */

const OPS = {
  status: opStatus,
  write: opWrite,
  read: opRead,
  mkdir: opMkdir,
  list: opList,
  exists: opExists,
  remove: opRemove,
  clear: opClear,
};

function friendlyError(err) {
  if (err && err.name === "NotFoundError") {
    return "Introuvable : le fichier ou dossier n'existe pas.";
  }
  if (err && err.name === "TypeMismatchError") {
    return "Type inattendu : le chemin pointe vers un fichier au lieu d'un dossier, ou l'inverse.";
  }
  return String((err && err.message) || err);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.op !== "string") return false;
  const handler = OPS[msg.op];
  if (!handler) {
    sendResponse({ ok: false, error: `Opération inconnue : ${msg.op}` });
    return false;
  }
  handler(msg)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: friendlyError(err) }));
  return true; // réponse asynchrone
});
