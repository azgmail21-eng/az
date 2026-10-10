#!/usr/bin/env node
// Enregistre le Native Messaging Host pour Microsoft Edge sur Windows.
// Usage : node install.mjs --extension-id <ID visible sur edge://extensions>

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getDocumentsDirectory } from "./windows-folders.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST_NAME = "com.arena.documents";
const REGISTRY_KEY = `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`;

function getArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const rawExtensionId = getArg("extension-id");
if (!rawExtensionId || !/^[a-p]{32}$/i.test(rawExtensionId)) {
  console.error("Erreur : indique l'ID Edge de l'extension avec --extension-id (32 lettres de a à p).\nTrouve-le sur edge://extensions après avoir chargé extension/.");
  process.exit(1);
}
const extensionId = rawExtensionId.toLowerCase();

if (process.platform !== "win32") {
  console.error("Ce programme d'installation ne gère que Microsoft Edge sous Windows.");
  process.exit(1);
}

const documentsDirectory = getDocumentsDirectory();
fs.mkdirSync(documentsDirectory, { recursive: true });

// Le navigateur lance ce petit wrapper à la demande, un appel par action.
const nodeExecutable = process.execPath;
const hostScript = path.join(__dirname, "host.mjs");
const wrapperPath = path.join(__dirname, "filehost.bat");
const manifestPath = path.join(__dirname, `${HOST_NAME}.json`);

const wrapper = `@echo off\r\nchcp 65001 >nul\r\n"${nodeExecutable}" "${hostScript}" %*\r\n`;
fs.writeFileSync(wrapperPath, wrapper, "utf8");

const nativeManifest = {
  name: HOST_NAME,
  description: "Arena Documents Bridge - accès limité au dossier Documents Windows",
  path: wrapperPath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`],
};
fs.writeFileSync(manifestPath, JSON.stringify(nativeManifest, null, 2), "utf8");

try {
  execFileSync(
    "reg.exe",
    ["add", REGISTRY_KEY, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"],
    { stdio: "inherit", windowsHide: true }
  );
} catch (error) {
  console.error("Échec de l'enregistrement du Native Host dans le registre :", error.message);
  process.exit(1);
}

console.log("\nInstallation terminée pour Microsoft Edge.");
console.log(`Dossier autorisé : ${documentsDirectory}`);
console.log("Les actions automatiques sont limitées à ce dossier. Aucun mode illimité n'existe.");
console.log("Redémarre complètement Edge pour que le Native Host soit chargé.");
