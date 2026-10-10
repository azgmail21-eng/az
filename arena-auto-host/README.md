# ⚡ Arena Auto Host — programme local verrouillé sur Documents

Petit programme **Node.js** qui donne à l'extension
**Arena Auto Native** (`../arena-auto-native/`) un accès disque **sans aucun
clic**, via le mécanisme officiel *Native Messaging* d'Edge/Chrome.

Aucun processus permanent : Edge lance `host.mjs` à chaque action, reçoit la
réponse, puis le termine.

## 🔒 Contrat de sécurité (non configurable)

- Dossier autorisé **imposé et codé en dur** : `%USERPROFILE%\Documents`.
  Il n'existe **aucune option** pour le changer.
- Tous les chemins reçus doivent être **relatifs** à Documents.
- Refusés : `..`, chemins absolus, lettres de lecteur (`C:...`), schémas.
- Actions : `ping`, `read`, `list`, `mkdir`, `write`. **Pas de suppression.**
- Seule **ton extension** (ID précis dans `allowed_origins`) peut appeler ce
  host — aucun site web ni aucune autre extension ne le peut.
- Limites : lecture ≤ 512 Ko/réponse, écriture ≤ 900 Ko, liste ≤ 500 entrées
  (le canal natif est limité à ~1 Mo par message).

## 🚀 Installation (Windows)

Prérequis : Node.js + l'extension Arena Auto Native chargée dans Edge
(note son **ID** sur `edge://extensions`).

```powershell
cd arena-auto-host
node install.mjs --browser edge --extension-id TON_ID_ICI
```

Puis **ferme complètement Edge** (vérifie qu'il ne reste aucun `msedge.exe`
dans le Gestionnaire des tâches) et rouvre-le.

Désinstallation :

```powershell
node install.mjs --uninstall --browser edge
```

## 📡 Protocole (JSON via stdin/stdout)

Requête :

```json
{ "action": "write", "path": "projet/app.py", "content": "print(1)\n" }
{ "action": "read", "path": "projet/app.py" }
{ "action": "list", "path": "projet" }
{ "action": "mkdir", "path": "projet/src" }
{ "action": "ping" }
```

Réponse : `{ "ok": true, ... }` ou `{ "ok": false, "error": "..." }`.

## 🧪 Tests

```bash
npm test   # inclut tests/autohost.test.mjs : le host est lancé en vrai
           # dans un dossier temporaire (ARENA_AUTO_DOCS), jamais dans
           # tes vrais Documents.
```
