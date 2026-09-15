# DeepSeek Local File Bridge

Extension navigateur + Native Messaging Host pour donner à DeepSeek (page web)
un accès lecture/écriture à **un dossier local que tu choisis**.

Aucun processus ne tourne en continu : le navigateur lance le host à la
demande, reçoit la réponse, puis le termine.

---

## 1. Charger l'extension dans Edge

1. Ouvre `edge://extensions`
2. Active le **Mode développeur** (en bas à gauche)
3. Clique sur **Charger l'extension décompressée**
4. Sélectionne le dossier `extension/`
5. Note l'**ID de l'extension** affiché sous son nom (ex: `abcdefghijkl...`)

## 2. Installer le Native Host

Prérequis : Node.js installé (tu l'as déjà).

Ouvre un terminal dans le dossier `native-host/` et lance :

**Mode restreint (recommandé)** — accès à un seul dossier :
```
node install.mjs --browser edge --extension-id TON_ID_ICI --folder "C:\Users\remi\Documents\DeepSeekFiles"
```

**Mode illimité** — accès à tout le disque (sauf Windows/Program Files/ProgramData,
protégés en dur même dans ce mode) :
```
node install.mjs --browser edge --extension-id TON_ID_ICI --unrestricted
```

⚠️ En mode illimité, une mauvaise manipulation (ou une mauvaise interprétation
d'une instruction par DeepSeek) peut écraser ou supprimer n'importe quel fichier
personnel accessible à ton compte Windows. Chaque écriture demande une
confirmation dans le panneau, mais il n'y a pas de retour en arrière une fois
confirmé — pas de corbeille, pas de sauvegarde automatique. Fais des copies de
sauvegarde de ce qui compte avant d'utiliser ce mode.

Le script affiche un résumé et confirme l'écriture du manifest + de la clé
de registre.

## 3. Redémarrer le navigateur

Ferme **complètement** Edge (vérifie dans le Gestionnaire des tâches qu'il
n'y a plus de `msedge.exe`), puis rouvre-le.

## 4. Utiliser

Va sur `https://chat.deepseek.com`. Un petit panneau **"📁 File Bridge"**
apparaît en bas à droite de la page, avec trois boutons :

- **Lister** : affiche le contenu du dossier autorisé (ou d'un sous-dossier)
- **Lire** : lit un fichier et affiche son contenu
- **Écrire** : crée ou remplace un fichier avec le contenu que tu saisis

Le résultat s'affiche dans la zone de texte du panneau. Tu peux :
- **Copier le résultat** dans le presse-papier
- **Insérer dans le chat** pour coller le contenu directement dans le champ
  de saisie de DeepSeek

## 5. Mode automatique (DeepSeek déclenche les actions lui-même)

Par défaut, c'est toi qui cliques sur les boutons. Pour que **DeepSeek** puisse
lire/écrire/créer des dossiers directement pendant la conversation, colle ceci
dans ses paramètres (Personnalisation / instructions système / "Custom
Instructions" selon la version de l'interface) :

```
Tu as accès à un pont de fichiers locaux. Quand tu as besoin de lire, écrire,
lister ou créer un dossier sur l'ordinateur de l'utilisateur, écris UNE ligne
exactement sous cette forme, sans bloc de code, sans backticks :

FILEBRIDGE_ACTION: {"action":"read","path":"C:\\chemin\\complet\\fichier.txt"}
FILEBRIDGE_ACTION: {"action":"write","path":"C:\\chemin\\complet\\fichier.txt","content":"le contenu"}
FILEBRIDGE_ACTION: {"action":"list","path":"C:\\chemin\\complet\\dossier"}
FILEBRIDGE_ACTION: {"action":"mkdir","path":"C:\\chemin\\complet\\nouveaudossier"}

N'écris qu'une seule action à la fois, attends le résultat avant de continuer.
Le JSON doit être valide (chemins avec double antislash \\\\).
```

Une fois cette ligne détectée dans la réponse de DeepSeek, le panneau :
- l'exécute automatiquement pour `read`, `list`, `mkdir` (aucune confirmation)
- demande une confirmation dans une popup pour `write` (sécurité)
- pré-remplit le champ de texte avec le résultat

**Il te reste un clic manuel** : appuyer sur Entrée ou "Envoyer" pour que
DeepSeek voie le résultat et continue la conversation. Ce n'est pas
100% invisible — la page web de DeepSeek n'offre pas de vrai mécanisme de
function calling pour les extensions tierces, donc ce dernier clic est la
limite technique réelle de cette approche.

Édite directement le fichier `native-host/config.json` généré par
l'installation, champ `baseDir`. Pas besoin de tout réinstaller.

## Sécurité

- Le host refuse tout chemin qui sortirait du dossier autorisé
  (protection contre les `../../`).
- Le manifest natif n'autorise que ton extension précise (`allowed_origins`)
  à parler au host — aucune autre extension ou site ne peut l'utiliser.
- Le code est entièrement local et lisible : `native-host/host.mjs` fait
  une trentaine de lignes utiles, tu peux vérifier exactement ce qu'il fait.

## Désinstaller

```
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.localbridge.filehost" /f
```

Puis retire l'extension depuis `edge://extensions`.
