# Arena FS — accès « Documents » pour l'IA d'Arena.ai

Extension **Edge / Chrome** (Manifest V3) qui permet à l'IA d'**Arena.ai (Agent Mode)**
de **créer des dossiers, créer des fichiers et lire des fichiers** directement dans
**votre dossier Documents**, **sans vous demander d'autorisation à chaque fois**.

Tout est **strictement limité au dossier que vous connectez** : l'IA ne peut pas en
sortir (pas de chemins absolus, `..` interdit, chaque nom validé).

Différence avec le pont DeepSeek (`extension/` + `native-host/` à la racine de ce dépôt) :
**aucun Node.js, aucun registre Windows, aucun programme à installer** — tout tient
dans l'extension, grâce à l'API *File System Access* du navigateur.

---

## 1. Installer dans Edge

1. Ouvre `edge://extensions`
2. Active le **Mode développeur** (en bas à gauche)
3. Clique sur **Charger l'extension décompressée**
4. Sélectionne le dossier `arena-extension/`

## 2. Connecter ton dossier Documents (une seule fois)

1. Clique sur l'icône de l'extension **Arena FS**
2. Clique sur **📁 Choisir le dossier Documents…** et sélectionne ton dossier `Documents`
3. (Optionnel) Clique sur **🧪 Fichier de test** : ça crée
   `Documents/Arena-AI/fichier-test.txt` pour vérifier que ça marche

> Le navigateur exige ce choix manuel **une fois** (sécurité impossible à contourner).
> Ensuite la permission est mémorisée : **plus jamais aucune fenêtre d'autorisation**,
> même après un redémarrage du navigateur.

## 3. Laisser l'IA agir toute seule

Sur `https://arena.ai`, l'extension surveille les réponses de l'IA. Quand l'IA écrit
une ligne `ARENAFS_ACTION: {...}`, elle est **exécutée automatiquement, sans
confirmation**, et le résultat est **inséré dans le champ de saisie** du chat —
il ne te reste qu'à appuyer sur **Envoyer** pour que l'IA voie le résultat et
continue (Arena.ai ne permet pas à une extension d'envoyer un message à sa place :
c'est la seule limite technique).

Pour que l'IA connaisse le protocole, colle ce texte au début de ta conversation
(dans ton premier message ou dans les instructions personnalisées) :

```
Tu as accès à un pont de fichiers local sur l'ordinateur de l'utilisateur,
limité à son dossier Documents. Quand tu dois créer un dossier, créer/écrire
ou lire un fichier, écris UNE seule ligne au format exact ci-dessous, hors de
tout bloc de code, puis attends le ARENAFS_RESULT avant de continuer :

ARENAFS_ACTION: {"action":"mkdir","path":"Projets/mon-site"}
ARENAFS_ACTION: {"action":"write","path":"Projets/mon-site/index.html","content":"<h1>Bonjour</h1>"}
ARENAFS_ACTION: {"action":"read","path":"Projets/mon-site/index.html"}
ARENAFS_ACTION: {"action":"list","path":"Projets"}
ARENAFS_ACTION: {"action":"exists","path":"Projets/mon-site"}
ARENAFS_ACTION: {"action":"remove","path":"Projets/mon-site"}

Règles :
- Une seule action par message, chemins RELATIFS au dossier Documents.
- Ne mets pas ces lignes dans un bloc de code, n'affiche pas d'exemples hors actions réelles.
- Les dossiers intermédiaires sont créés automatiquement avec "write".
- Pour un fichier binaire (image…), utilise "encoding":"base64" avec le contenu en base64.
- Après un ARENAFS_RESULT en erreur, corrige le tir au lieu de répéter la même action.
```

### Boucle typique

1. Tu demandes : « crée-moi un site web dans mes Documents »
2. L'IA répond avec `ARENAFS_ACTION: {"action":"write","path":"Projets/mon-site/index.html","content":"…"}`
3. L'extension crée le dossier + le fichier dans `Documents/Projets/mon-site/`
   et insère `ARENAFS_RESULT: {"ok":true,…}` dans le champ de saisie
4. Tu appuies sur **Envoyer**, l'IA voit le résultat et enchaîne sur le fichier suivant

Le petit panneau **Arena FS** en bas à droite d'arena.ai affiche le journal de tout
ce qui a été fait (transparence totale, mais sans blocage).

## 4. API JavaScript (bonus)

Sur arena.ai, l'extension expose aussi `window.arenaFS` dans la page
(console, script utilisateur, page web) :

```js
await arenaFS.mkdir("Projets/mon-site");
await arenaFS.writeFile("Projets/mon-site/index.html", "<h1>Salut</h1>");
const texte = await arenaFS.readFile("Projets/mon-site/index.html");
const { entries } = await arenaFS.list("Projets");
await arenaFS.exists("Projets/mon-site");
await arenaFS.remove("Projets/mon-site");   // récursif par défaut
await arenaFS.status();
```

## 5. Sécurité

- **Sandbox stricte** : toutes les opérations sont résolues à l'intérieur du dossier
  connecté. Chemins absolus refusés, `..` interdit, caractères invalides refusés,
  limite de taille (~45 Mo par fichier).
- **Journal visible** : chaque action exécutée apparaît dans le panneau Arena FS.
- **Interrupteurs** : dans le panneau tu peux désactiver l'auto-exécution
  (l'extension ne fait alors plus rien toute seule) et/ou l'auto-insertion des résultats.
- **Révocation** : bouton « Déconnecter » dans le popup = l'IA n'a plus accès à rien.
- Le navigateur impose toujours le **premier** choix manuel du dossier ; ensuite la
  permission persiste — c'est voulu, c'est le but de l'extension.
- Comme le pont donne un vrai accès en écriture : si tu demandes à l'IA de supprimer
  quelque chose, il n'y a pas de corbeille. Garde des sauvegardes de ce qui compte.

## 6. Fichiers de l'extension

| Fichier | Rôle |
|---|---|
| `manifest.json` | Manifeste MV3, cible `https://*.arena.ai/*` |
| `background.js` | Service worker : toutes les opérations fichiers, sandbox |
| `db.js` | Persistance du handle de dossier (IndexedDB) |
| `content.js` | Relais page↔extension, exécution auto des `ARENAFS_ACTION`, panneau |
| `inject.js` | API `window.arenaFS` injectée dans la page |
| `popup.html` / `popup.js` | Choix du dossier, test, déconnexion |
| `icons/` | Icônes (générées par `tools/make_icons.py`) |

## Désinstaller

`edge://extensions` → Arena FS → **Supprimer**, puis décoche/supprime la permission
du dossier si tu veux être sûr (Paramètres du site arena.ai → Emplacements de fichiers).
