// Copie JSZip (dépendance npm) dans l'extension pour l'export ZIP hors-ligne.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'jszip', 'dist', 'jszip.min.js');
const destDir = join(root, 'arena-extension', 'vendor');
const dest = join(destDir, 'jszip.min.js');

if (!existsSync(src)) {
  console.error('❌ node_modules/jszip introuvable — lance `npm install` d’abord.');
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`✅ JSZip vendorisé (${dest})`);
