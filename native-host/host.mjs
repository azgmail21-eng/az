#!/usr/bin/env node
// Native Messaging host for Arena Documents Bridge.
// It is started by Edge only when the extension sends a file operation.

import path from "node:path";
import { pathToFileURL } from "node:url";
import { executeFileAction } from "./file-operations.mjs";
import { getDocumentsDirectory } from "./windows-folders.mjs";

const MAX_MESSAGE_BYTES = 1024 * 1024;

function readMessage() {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    let expectedLength = null;

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("error", onError);
    };

    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length > MAX_MESSAGE_BYTES + 4) {
        cleanup();
        reject(new Error("Message Native Messaging trop volumineux."));
        return;
      }

      if (expectedLength === null && buffered.length >= 4) {
        expectedLength = buffered.readUInt32LE(0);
        if (expectedLength > MAX_MESSAGE_BYTES) {
          cleanup();
          reject(new Error("Message Native Messaging trop volumineux."));
          return;
        }
      }

      if (expectedLength !== null && buffered.length >= 4 + expectedLength) {
        const body = buffered.subarray(4, 4 + expectedLength).toString("utf8");
        cleanup();
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("Le message reçu n'est pas un JSON valide."));
        }
      }
    };

    const onEnd = () => {
      cleanup();
      if (buffered.length === 0) resolve(null);
      else reject(new Error("Message Native Messaging incomplet."));
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.once("error", onError);
  });
}

function sendMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > MAX_MESSAGE_BYTES) {
    const fallback = Buffer.from(
      JSON.stringify({ ok: false, error: "Réponse trop volumineuse pour Native Messaging." }),
      "utf8"
    );
    const header = Buffer.alloc(4);
    header.writeUInt32LE(fallback.length, 0);
    process.stdout.write(Buffer.concat([header, fallback]));
    return;
  }

  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

async function handle(message) {
  const documentsDirectory = getDocumentsDirectory();
  return executeFileAction(documentsDirectory, message);
}

async function main() {
  let result;
  try {
    const message = await readMessage();
    if (message === null) return;
    result = await handle(message);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    result = { ok: false, error: detail.slice(0, 1200) };
  }
  sendMessage(result);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    sendMessage({ ok: false, error: error?.message || "Erreur inconnue du Native Host." });
    process.exitCode = 1;
  });
}
