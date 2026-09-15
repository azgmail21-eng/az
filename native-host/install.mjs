#!/usr/bin/env node
// Installe le Native Messaging Host pour Edge ou Chrome sur Windows.
// Usage : node install.mjs --browser edge --extension-id <ID> [--folder "C:\chemin\dossier"]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const browser = getArg("browser", "edge"); // "edge" ou "chrome"
const extensionId = getArg("extension-id");
const folder = getArg("folder");
const unrestricted = process.argv.includes("--unrestricted");

if (!extensionId) {
  console.error("Erreur: --extension-id est requis (visible sur edge://extensions).");
  process.exit(1);
}

if (process.platform !== "win32") {
  console.error("Ce script d'installation ne gère que Windows pour le moment.");
  process.exit(1);
}

const HOST_NAME = "com.localbridge.filehost";
const nodeExe = process.execPath; // chemin absolu du node.exe qui exécute ce script
const hostScript = path.join(__dirname, "host.mjs");
const wrapperBat = path.join(__dirname, "filehost.bat");
const manifestPath = path.join(__dirname, `${HOST_NAME}.json`);
const configPath = path.join(__dirname, "config.json");

// 1. Écrit la config
const baseDir = folder || path.join(process.env.USERPROFILE || ".", "DeepSeekFiles");
if (!unrestricted) fs.mkdirSync(baseDir, { recursive: true });
fs.writeFileSync(
  configPath,
  JSON.stringify({ unrestricted, baseDir }, null, 2),
  "utf-8"
);
if (unrestricted) {
  console.log("⚠️  Mode ILLIMITÉ activé : accès à tout le disque (sauf Windows/Program Files/ProgramData).");
} else {
  console.log(`Dossier autorisé : ${baseDir}`);
}

// 2. Écrit le wrapper .bat (référence absolue à node.exe, pas de dépendance au PATH)
const batContent = `@echo off\r\n"${nodeExe}" "${hostScript}" %*\r\n`;
fs.writeFileSync(wrapperBat, batContent, "utf-8");
console.log(`Wrapper créé : ${wrapperBat}`);

// 3. Écrit le manifest natif
const manifest = {
  name: HOST_NAME,
  description: "DeepSeek Local File Bridge - lecture/écriture de fichiers locaux à la demande",
  path: wrapperBat,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`],
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
console.log(`Manifest créé : ${manifestPath}`);

// 4. Enregistre la clé de registre (HKCU, pas besoin de droits admin)
const browserKey = browser === "chrome" ? "Google\\Chrome" : "Microsoft\\Edge";
const regPath = `HKCU\\Software\\${browserKey}\\NativeMessagingHosts\\${HOST_NAME}`;

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
console.log(`Host: ${HOST_NAME}`);
console.log(`Navigateur: ${browser}`);
console.log(`Origine autorisée: chrome-extension://${extensionId}/`);
console.log("\nRedémarre complètement le navigateur (tous les processus fermés) avant de tester.");
