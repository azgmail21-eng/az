// Arena FS — API JavaScript exposée à la page arena.ai (monde MAIN).
// Usage (depuis la console, un script utilisateur, ou l'IA via le protocole
// ARENAFS_ACTION) :
//   await arenaFS.mkdir("Projets/mon-site")
//   await arenaFS.writeFile("Projets/mon-site/index.html", "<h1>Salut</h1>")
//   const texte = await arenaFS.readFile("Projets/mon-site/index.html")
//   await arenaFS.list("Projets")
// Tout est limité au dossier connecté via le popup de l'extension.

(() => {
  "use strict";
  if (window.arenaFS) return;

  const REQ_SOURCE = "arena-fs-page";
  const RES_SOURCE = "arena-fs-bg";
  const pending = new Map();
  let seq = 0;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.source !== RES_SOURCE || data.type !== "response") return;
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.ok) p.resolve(data.result);
    else p.reject(new Error(data.error || "Erreur inconnue du pont Arena FS."));
  });

  function call(op, args = {}, timeoutMs = 60000) {
    const id = `${Date.now().toString(36)}-${(++seq).toString(36)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Délai dépassé pour l'opération « ${op} ».`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      window.postMessage({ source: REQ_SOURCE, type: "request", id, op, args }, "*");
    });
  }

  function toBase64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  const arenaFS = {
    /** Crée ou remplace un fichier (les dossiers intermédiaires sont créés automatiquement). */
    writeFile(path, content) {
      if (typeof content === "string") {
        return call("write", { path, content, encoding: "text" });
      }
      const bufPromise = content instanceof ArrayBuffer
        ? Promise.resolve(content)
        : Promise.resolve(content.arrayBuffer());
      return bufPromise.then((ab) => call("write", { path, content: toBase64(ab), encoding: "base64" }));
    },
    /** Lit un fichier texte. */
    async readFile(path) {
      const r = await call("read", { path, encoding: "text" });
      return r.content;
    },
    /** Lit un fichier (binaire ou non) et renvoie son contenu en base64. */
    async readFileBase64(path) {
      const r = await call("read", { path, encoding: "base64" });
      return r.base64;
    },
    /** Crée un dossier (récursivement). */
    mkdir(path) {
      return call("mkdir", { path });
    },
    /** Liste un dossier : { path, entries: [{name, kind}] }. */
    list(path = "") {
      return call("list", { path });
    },
    /** { path, exists, kind? } */
    exists(path) {
      return call("exists", { path });
    },
    /** Supprime un fichier ou un dossier (récursif par défaut). */
    remove(path, recursive = true) {
      return call("remove", { path, recursive });
    },
    /** État de la connexion : { connected, name?, permission? }. */
    status() {
      return call("status");
    },
  };

  Object.defineProperty(window, "arenaFS", { value: arenaFS, configurable: false });
  window.dispatchEvent(new CustomEvent("arena-fs-ready"));
  console.info(
    "[Arena FS] window.arenaFS prêt : writeFile, readFile, readFileBase64, mkdir, list, exists, remove, status. " +
    "Toutes les opérations sont limitées au dossier connecté via l'extension."
  );
})();
