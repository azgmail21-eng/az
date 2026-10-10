import { execFileSync } from "node:child_process";
import path from "node:path";

const USER_SHELL_FOLDERS =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";
const SHELL_FOLDERS =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders";

function queryRegistryValue(key, valueName) {
  const output = execFileSync("reg.exe", ["query", key, "/v", valueName], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const escapedName = valueName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = output.match(
    new RegExp(`^\\s*${escapedName}\\s+REG_(?:EXPAND_)?SZ\\s+(.+?)\\s*$`, "im")
  );
  return match?.[1]?.trim() || null;
}

function expandEnvironmentVariables(value) {
  const variables = new Map(
    Object.entries(process.env).map(([name, content]) => [name.toLowerCase(), content])
  );

  return value.replace(/%([^%]+)%/g, (whole, name) => {
    const replacement = variables.get(name.toLowerCase());
    if (replacement === undefined) {
      throw new Error(`Impossible de résoudre la variable Windows ${whole} dans le chemin Documents.`);
    }
    return replacement;
  });
}

/** Read Windows' registered Known Folder path for Documents (including OneDrive redirection). */
export function getDocumentsDirectory() {
  if (process.platform !== "win32") {
    throw new Error("Le Native Host est prévu pour Windows et Microsoft Edge.");
  }

  let value = null;
  try {
    value = queryRegistryValue(USER_SHELL_FOLDERS, "Personal");
    if (value) value = expandEnvironmentVariables(value);
  } catch {
    value = null;
  }
  if (!value) {
    // Certains profils ne définissent que l'ancienne clé « Shell Folders ».
    try {
      value = queryRegistryValue(SHELL_FOLDERS, "Personal");
    } catch {
      value = null;
    }
  }

  if (!value) {
    throw new Error("Impossible de déterminer le dossier Documents Windows (valeur Personal du registre absente).");
  }

  const documentsDirectory = value.replace(/^"|"$/g, "");
  if (!path.win32.isAbsolute(documentsDirectory)) {
    throw new Error("Le chemin Documents enregistré par Windows n'est pas absolu.");
  }
  return path.win32.normalize(documentsDirectory);
}
