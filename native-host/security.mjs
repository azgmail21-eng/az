import path from "node:path";

/** True only when target is base itself or one of its descendants. */
export function isInsideDirectory(baseDirectory, targetPath) {
  const base = path.resolve(baseDirectory);
  const target = path.resolve(targetPath);
  const relative = path.relative(base, target);

  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

/**
 * Resolve a user/agent supplied path below Documents.
 * Paths are deliberately relative: absolute paths, drive paths, UNC paths,
 * parent traversal, and Windows device/alternate-stream names are rejected.
 */
export function resolveDocumentsPath(baseDirectory, inputPath, { allowRoot = false } = {}) {
  if (typeof inputPath !== "string") {
    throw new Error("Le chemin doit être une chaîne relative au dossier Documents.");
  }
  if (inputPath.length > 4096 || inputPath.includes("\0")) {
    throw new Error("Chemin invalide ou trop long.");
  }

  const normalizedSeparators = inputPath.replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(normalizedSeparators) ||
    path.win32.isAbsolute(inputPath) ||
    /^[a-z]:/i.test(inputPath)
  ) {
    throw new Error("Utilise un chemin relatif à Documents, jamais un chemin absolu.");
  }

  const rawSegments = normalizedSeparators.split("/");
  if (rawSegments.some((segment) => segment === "..")) {
    throw new Error("Chemin refusé : la sortie du dossier Documents n'est pas autorisée.");
  }

  const segments = rawSegments.filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 && !allowRoot) {
    throw new Error("Un chemin de fichier ou de sous-dossier est requis.");
  }

  for (const segment of segments) {
    if (
      segment.length > 255 ||
      /[<>:"|?*\x00-\x1f]/.test(segment) ||
      /[. ]$/.test(segment) ||
      /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i.test(segment)
    ) {
      throw new Error(`Nom de fichier non autorisé : ${segment}`);
    }
  }

  const base = path.resolve(baseDirectory);
  const target = path.resolve(base, ...segments);
  if (!isInsideDirectory(base, target)) {
    throw new Error("Chemin refusé : la sortie du dossier Documents n'est pas autorisée.");
  }

  return target;
}
