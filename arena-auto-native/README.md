# ⚡ Arena Auto Native — L'IA dans Documents, zéro clic

Extension **Microsoft Edge** (compatible Chrome) + petit programme local pour
[`arena.ai/agent`](https://arena.ai/agent) : l'agent **lit, crée des dossiers
et écrit des fichiers tout seul, sans ta confirmation et sans sélecteur de
dossier**, uniquement dans **`Documents`**.

C'est la version **la plus automatique** des trois :

| | Arena Saver | Arena Auto | **Arena Auto Native** |
|---|---|---|---|
| Principe | Tu sauvegardes à la main | L'IA agit seule (API navigateur) | **L'IA agit seule (programme local)** |
| Clics par session | À chaque sauvegarde | 1 au début (+ parfois re-autorisation) | **0 après l'installation** |
| Dossier | Tu choisis | Tu choisis | **Documents, imposé** |
| Installation | Extension seule | Extension seule | **Extension + 1 commande** |

## 🚀 Installation

### 1. L'extension

1. Récupère ce dépôt (bouton vert **Code → Download ZIP**, ou `git clone`).
2. Ouvre `edge://extensions` → **Mode développeur** → **Charger l'extension
   décompressée** → dossier **`arena-auto-native/`**.
3. Note l'**ID de l'extension** affiché sous son nom.

### 2. Le programme local (une fois pour toutes)

Prérequis : Node.js installé.

```powershell
cd arena-auto-host
node install.mjs --browser edge --extension-id TON_ID_ICI
```

Le script enregistre le programme auprès d'Edge. Le dossier autorisé est
**imposé** (`%USERPROFILE%\Documents`) — il n'y a aucune option pour le
changer, c'est la garantie.

### 3. Redémarre Edge complètement

Ferme **toutes** les fenêtres (aucun `msedge.exe` restant), puis rouvre.

### 4. Vérifie

Va sur `https://arena.ai/agent` : le panneau **⚡ Arena Native** affiche
`📁 Documents (imposé 🔒) ✅`. Sinon, clique sur **Tester** et lis le message.

## 🧠 Instructions système à coller dans Arena

Colle ce texte dans les instructions personnalisées de l'agent :

~~~text
You have autonomous access to the user's Documents folder through the Arena
Auto Native extension. When you need to work with local files, emit ONE
standalone fenced block exactly like below (nothing else inside the block).

To CREATE or OVERWRITE a file (relative path inside Documents, forward slashes):

```arenafs
WRITE: project/app.py
---
<exact and COMPLETE file content here>
```

To READ a file, LIST a folder, or CREATE a folder:

```arenafs
ACTION: read
PATH: project/app.py
```

(ACTION is one of: read, list, mkdir. PATH is relative to Documents.
Use PATH: . to list the root of Documents.)

Rules:
- One action per block. Wait for the result message before the next action.
- Paths are relative to Documents only: never absolute paths, drive letters,
  or ".." — they are rejected by the sandbox.
- Keep each file under ~200 KB. For write, put the COMPLETE file content
  after the --- line.
- After you get "OK", continue helping the user; do not re-emit the same
  action.
~~~

Ensuite : *« Crée un dossier `mon-projet` avec un `app.py` qui affiche
Bonjour »* → les fichiers apparaissent dans `Documents\mon-projet`, sans que
tu cliques quoi que ce soit. 🎉

## 🔒 Sécurité

- **Double sandbox** : l'extension ET le programme refusent tout ce qui n'est
  pas un chemin relatif à Documents (`..`, absolus, `C:` rejetés des deux côtés).
- **Pas d'action de suppression** (l'IA peut créer/écraser, pas effacer).
- **Seule ton extension** (ID précis) peut appeler le programme local.
- **Journal complet** : chaque action (heure + chemin + résultat) est visible
  dans le panneau et la popup + interrupteur ⏸ immédiat.
- **Anti-boucle** : action répétée ignorée, pause auto au-delà de 20/min.
- Le programme ne tourne **jamais en fond** : lancé par action, terminé aussitôt.
- Tout le code est lisible : `arena-auto-host/host.mjs` (~150 lignes).

## ⚠️ Limites honnêtes

- L'installation du programme + un redémarrage d'Edge sont requis (une fois).
- Le **renvoi auto du résultat à l'IA** est best-effort : si l'interface
  d'Arena bloque l'envoi, le résultat reste **pré-rempli** et tu appuies sur
  **Entrée** (le journal l'indique).
- Un `write` **écrase** le fichier cible sans corbeille ni sauvegarde :
  circonscrit à Documents, mais ne mets pas d'unique-exemplaire-précieux
  pile où l'IA écrit. En cas de doute : coupe le pilote avec ⏸.

## 🛟 Dépannage

- **`❌` / Host injoignable** : vérifie que l'ID dans
  `arena-auto-host/com.arenaauto.filehost.json` (`allowed_origins`) est bien
  celui affiché sur `edge://extensions`, puis **redémarre Edge complètement**.
  Relance `node install.mjs ...` en cas de doute.
- **Rien ne se passe** : instructions système collées ? Pilote actif (pastille
  verte) ? Host ✅ ? Recharge la page (F5).
- **`⚠️ Bloc ignoré`** : format du bloc incorrect (la raison est affichée) —
  reformule ta demande.
- **`⏸️ Pause automatique`** : l'IA bouclait → dis-lui d'arrêter, réactive avec ▶.

Désinstallation :

```powershell
node install.mjs --uninstall --browser edge
```

puis retire l'extension dans `edge://extensions`.

## 🛠️ Développement

```bash
npm test            # Saver + Auto + host natif (lancé en vrai dans un dossier temp)
npm run icons:native  # régénère les icônes sarcelle
```

> `autofs.js` est partagé à l'identique avec `arena-auto/` : le test
> `tests/autohost.test.mjs` vérifie que les deux copies sont synchronisées.
> Modifie les deux ensemble.
