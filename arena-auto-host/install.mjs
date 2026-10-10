#!/usr/bin/env node
// Installe / désinstalle le host natif "Arena Auto" (Documents uniquement).
// Installation   : node install.mjs --browser edge --extension-id <ID>
// Désinstallation: node install.mjs --uninstall --browser edge
//
// --extension-id est visible sur edge://extensions (sous le nom de l'extension).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST_NAME = "com.arenaauto.filehost";

function getArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const browser = getArg("browser", "edge"); // "edge" ou "chrome"
const extensionId = getArg("extension-id");
const uninstall = process.argv.includes("--uninstall");

if (process.platform !== "win32") {
  console.error("Ce script d'installation ne gère que Windows pour le moment.");
  process.exit(1);
}

const browserKey = browser === "chrome" ? "Google\\Chrome" : "Microsoft\\Edge";
const regPath = `HKCU\\Software\\${browserKey}\\NativeMessagingHosts\\${HOST_NAME}`;

if (uninstall) {
  try {
    execFileSync("reg", ["delete", regPath, "/f"], { stdio: "inherit" });
    console.log("Host désinstallé. Pense aussi à retirer l'extension dans le navigateur.");
  } catch (e) {
    console.error("Échec de la désinstallation :", e.message);
    process.exit(1);
  }
  process.exit(0);
}

if (!extensionId) {
  console.error("Erreur : --extension-id est requis (visible sur edge://extensions).");
  process.exit(1);
}

const nodeExe = process.execPath;
const hostScript = path.join(__dirname, "host.mjs");
const wrapperBat = path.join(__dirname, "filehost.bat");
const manifestPath = path.join(__dirname, `${HOST_NAME}.json`);
const docsDir = path.join(process.env.USERPROFILE || ".", "Documents");

// 1. Le dossier autorisé est IMPOSÉ : Documents (aucune option pour le changer).
fs.mkdirSync(docsDir, { recursive: true });
console.log(`Dossier autorisé (imposé) : ${docsDir}`);

// 2. Wrapper .bat (référence absolue à node.exe, pas de dépendance au PATH)
fs.writeFileSync(wrapperBat, `@echo off\r\n"${nodeExe}" "${hostScript}" %*\r\n`, "utf-8");
console.log(`Wrapper créé : ${wrapperBat}`);

// 3. Manifest natif (seule TON extension est autorisée à appeler ce host)
const manifest = {
  name: HOST_NAME,
  description: "Arena Auto Native — accès autonome de l'IA au dossier Documents",
  path: wrapperBat,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`],
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
console.log(`Manifest créé : ${manifestPath}`);

// 4. Clé de registre HKCU (pas besoin de droits admin)
try {
  execFileSync("reg", ["add", regPath, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], {
    stdio: "inherit",
  });
  console.log(`Registre mis à jour : ${regPath}`);
} catch (e) {
  console.error("Échec de l'écriture du registre :", e.message);
  process.exit(1);
}

console.log("\nInstallation terminée.");
console.log(`Host : ${HOST_NAME}`);
console.log(`Navigateur : ${browser}`);
console.log(`Origine autorisée : chrome-extension://${extensionId}/`);
console.log("\nFerme COMPLÈTEMENT le navigateur (aucun processus msedge.exe), puis rouvre-le.");
