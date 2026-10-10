# 🤖 Arena Auto — L'IA pilote ton dossier Documents toute seule

Extension pour **Microsoft Edge** (fonctionne aussi sur Chrome) qui donne à
l'agent [`arena.ai/agent`](https://arena.ai/agent) un accès **autonome** à ton
dossier `Documents` :

- 📖 **lire** un fichier
- 📁 **créer** un dossier
- ✏️ **créer / écraser** un fichier
- 📋 **lister** un dossier

**Sans aucune confirmation de ta part** : dès que l'IA émet un bloc d'action
dans sa réponse, l'extension l'exécute et **renvoie le résultat à l'IA**
(envoi automatique best-effort, sinon pré-rempli — voir « Limites »).

> 🔒 **Sandbox stricte** : seuls les chemins **relatifs au dossier autorisé**
> sont acceptés. Les `..`, chemins absolus (`C:\...`, `/...`) et lettres de
> lecteur sont **rejetés**. Rien ne peut sortir de `Documents`.
>
> ⚠️ **Une seule autorisation requise** : le choix initial du dossier
> (un clic). C'est le navigateur qui l'impose — aucune extension au monde ne
> peut écrire sur ton disque sans ce geste. Après ça, tout est automatique.

---

## 🚀 Installation

1. Récupère ce dépôt (bouton vert **Code → Download ZIP**, ou `git clone`).
2. Ouvre `edge://extensions` → active le **Mode développeur**.
3. **Charger l'extension décompressée** → sélectionne le dossier
   **`arena-auto/`** (celui qui contient `manifest.json`).
4. Va sur `https://arena.ai/agent` : un panneau **🤖 Arena Auto** apparaît
   en bas à droite.
5. Clique sur **Choisir…** → sélectionne ton dossier **`Documents`**
   → accepte l'autorisation d'Edge. **C'est le seul clic nécessaire.**

> 💡 Les deux extensions **Arena Saver** (sauvegarde manuelle) et **Arena Auto**
> (pilote automatique) peuvent cohabiter sans conflit.

## 🧠 Activer l'IA : instructions système à coller

Pour que l'agent utilise son accès, colle ce texte dans ses **instructions
personnalisées** (Custom Instructions / Personnalisation, selon l'interface
d'Arena) :

~~~text
You have autonomous access to the user's Documents folder through the Arena
Auto extension. When you need to work with local files, emit ONE standalone
fenced block exactly like below (nothing else inside the block).

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

Ensuite, discute normalement : par exemple *« Crée un dossier `mon-projet`
avec un `app.py` qui affiche Bonjour »* → l'IA émet les blocs, l'extension
exécute, les fichiers apparaissent dans `Documents\mon-projet`. 🎉

## 🖥️ Le panneau

- **Pastille verte** = pilote actif ; **⏸/▶** = couper / réactiver.
- **📁 … (sandbox actif ✅)** = dossier autorisé. Tout reste dedans.
- **Journal** : chaque action avec heure, chemin et résultat.
- La **popup** (clic sur l'icône 🤖) montre la même chose + un interrupteur.

## 🛡️ Garde-fous

| Protection | Détail |
|---|---|
| Sandbox | Chemins relatifs uniquement, `..` / absolus / `C:` rejetés |
| Stabilité | Un bloc n'est exécuté que s'il est inchangé depuis 1,5 s (pas d'écriture à moitié générée) |
| Anti-boucle | Même action répétée > 2 fois = ignorée ; > 20 actions/min = pause auto (réactive avec ▶) |
| Tailles | Écriture ≤ 500 Ko, lecture renvoyée ≤ 100 Ko, liste ≤ 200 entrées |
| Traçabilité | Tout est journalisé dans le panneau (heure + chemin + résultat) |
| Interrupteur | Bouton ⏸ dans le panneau et la popup, effet immédiat |

Il n'y a **pas d'action de suppression** : l'IA peut créer et écraser, mais
pas effacer. (Un `write` écrase le fichier cible — c'est le seul risque,
circonscrit au dossier autorisé.)

## ⚠️ Limites honnêtes

- **Un clic initial obligatoire** (choix du dossier) + parfois un **clic de
  renouvellement** si Edge oublie l'autorisation (redémarrage, mise à jour).
  Le panneau te le dit clairement dans ce cas.
- **Envoi auto du résultat à l'IA = best-effort** : l'extension remplit le
  champ du chat et clique sur Envoyer. Si l'interface d'Arena a changé ou
  bloque l'envoi, le résultat reste **pré-rempli** et il te reste à appuyer
  sur **Entrée** (le journal l'indique : `⌨️ … appuie sur Entrée`).
- Les sites web n'offrent pas de vrai « function calling » aux extensions :
  le mécanisme repose sur la détection des blocs ` ```arenafs ` dans les
  réponses. Si l'IA oublie le format, rien ne se passe (aucun risque).

## 🛟 Dépannage

- **Rien ne se passe** : vérifie que les instructions système sont bien
  collées, que le pilote est actif (pastille verte), et qu'un dossier est
  autorisé. Recharge la page (F5).
- **`🔑 … clique sur la page pour ré-autoriser`** : Edge a perdu
  l'autorisation → clique n'importe où sur la page, ça reprend tout seul.
- **`⚠️ Bloc ignoré`** dans le journal : le format du bloc est incorrect
  (lis la raison affichée) — reformule ta demande à l'IA.
- **`⏸️ Pause automatique`** : l'IA bouclait probablement → réactive avec ▶
  après lui avoir dit d'arrêter de répéter.
- **Conflit avec Arena Saver ?** Aucun : IDs, stockages et panneaux séparés.

## 🛠️ Développement

```bash
npm install   # dépendances de test
npm test      # tests Saver + Auto (jsdom + sandbox)
npm run icons:auto  # régénère les icônes violettes
```

Structure :

```
arena-auto/
├── manifest.json   # Manifest V3 (Edge/Chrome)
├── autofs.js       # Format + sandbox + résultats (pur JS, testé)
├── auto.js         # Détection, exécution FS, renvoi auto à l'IA
├── auto.css        # Styles du panneau
├── popup.html/js   # Popup : état + journal + interrupteur
└── icons/          # Icônes violettes (tools/make-icons.mjs)
```
