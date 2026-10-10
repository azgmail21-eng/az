# Arena Documents Bridge pour Microsoft Edge

Cette extension permet à **Agent Mode sur arena.ai/agent** de lister, lire et créer des fichiers automatiquement dans le dossier Windows **Documents**.

- L'IA n'a pas besoin d'une confirmation à chaque lecture, création de dossier ou écriture.
- Elle ne peut agir que dans le dossier Documents reconnu par Windows : aucun mode « tout le disque » n'est fourni.
- Le pont local est lancé par Edge uniquement lorsqu'une action est demandée ; il ne tourne pas en service permanent.
- L'extension utilise des commandes textuelles dans des blocs `filebridge`. Ce n'est pas une intégration officielle ni un outil natif d'Arena.

> **Important :** l'IA peut lire le contenu de Documents et le renvoyer dans la conversation Arena. Une écriture peut remplacer un fichier existant dans Documents. N'y laisse pas de secrets et garde une sauvegarde des fichiers importants.

## Prérequis

- Windows et Microsoft Edge
- Node.js installé
- Le dépôt présent sur le PC où Edge est utilisé

## Installation

### 1. Charger l'extension dans Edge

1. Ouvre `edge://extensions`.
2. Active le **Mode développeur**.
3. Clique sur **Charger l'extension décompressée** et sélectionne le dossier `extension/` de ce dépôt.
4. Copie l'ID de l'extension affiché sur sa fiche (32 lettres de `a` à `p`).

### 2. Installer le pont local limité à Documents

Si tu avais installé l'ancienne extension DeepSeek File Bridge, retire son ancien enregistrement Native Messaging afin qu'il ne reste pas actif :

```powershell
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.localbridge.filehost" /f
```

Ouvre ensuite PowerShell dans le dépôt, puis lance :

```powershell
cd .\native-host
node .\install.mjs --extension-id ID_DE_TON_EXTENSION
```

Le programme lit le chemin Documents connu de Windows (y compris son éventuel déplacement vers OneDrive), crée le Native Host et l'autorise à communiquer avec **cet ID d'extension seulement**. Il n'existe ni option `--unrestricted`, ni option permettant d'autoriser tout le disque.

### 3. Redémarrer Edge et activer les instructions de l'agent

1. Ferme complètement Edge, puis rouvre-le.
2. Va sur [https://arena.ai/agent](https://arena.ai/agent). Le panneau **Arena · Documents** doit apparaître en bas à droite.
3. Clique sur **Tester le pont** : le statut doit indiquer que Documents est connecté.
4. Clique sur **Copier les instructions IA**, puis colle le texte dans les instructions personnalisées d'Agent Mode. Si Arena ne propose pas de réglage persistant, colle-le au début de la conversation.

## Utilisation

L'agent doit émettre **un bloc de code `filebridge` par action**. L'extension exécute l'action sans popup de confirmation, renvoie le résultat dans le champ de discussion et l'envoie automatiquement si le bouton Envoyer de la page est reconnu. Si l'interface Arena change et que l'envoi automatique n'est pas détecté, le résultat reste prêt dans le champ : clique alors sur **Envoyer**.

Les chemins sont relatifs à Documents, avec `/` comme séparateur. Exemples :

````text
```filebridge
ACTION: list
PATH: .
```
````

````text
```filebridge
ACTION: read
PATH: MonProjet/README.md
```
````

````text
```filebridge
ACTION: mkdir
PATH: MonProjet/src
```
````

Pour créer ou remplacer un fichier, le contenu commence après une ligne contenant exactement `---` :

````text
```filebridge
ACTION: write
PATH: MonProjet/src/main.py
---
print("Bonjour")
```
````

Actions disponibles : `list`, `read`, `mkdir`, `write`. Les opérations sont limitées au dossier Documents ; la suppression de fichiers n'est pas prise en charge. Les lectures sont limitées à 128 Ko, les écritures à 512 Ko, et l'affichage d'un dossier à 500 éléments.

Le bouton **Pause** suspend le déclenchement automatique dans l'onglet. Les boutons du panneau peuvent aussi servir à tester manuellement une action ; saisis alors un chemin relatif à Documents.

## Limites et sécurité

- Arena Agent Mode n'expose pas ici d'API officielle permettant à une extension tierce d'ajouter de vrais outils. Le pont repère donc uniquement les blocs de code explicitement étiquetés `filebridge` dans les réponses de l'agent.
- Le Native Host refuse les chemins absolus, les chemins `..`, les lecteurs/partages réseau, les liens symboliques et les jonctions sous Documents. La validation est faite côté extension **et** côté processus local.
- L'accès est limité au dossier Documents Windows. Les sous-dossiers sont inclus. Une demande de lecture envoie volontairement le contenu lu à Arena dans la conversation.
- `write` crée ou remplace le fichier cible. Il n'y a pas de confirmation par action ; utilise **Pause** ou retire l'extension si tu ne veux plus d'accès automatique.
- Ce projet vise Edge sous Windows et doit être chargé en mode développeur. Si l'interface Arena ou son bouton Envoyer change, l'exécution locale reste limitée à Documents, mais le retour automatique du résultat peut nécessiter un clic.

## Vérifier les tests

Depuis la racine du dépôt :

```bash
node --test native-host/file-operations.test.mjs
```

## Désinstallation

Dans PowerShell, supprime l'enregistrement du Native Host :

```powershell
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.arena.documents" /f
```

Puis retire l'extension depuis `edge://extensions`. Tu peux aussi supprimer les fichiers générés ignorés par Git dans `native-host/` : `filehost.bat` et `com.arena.documents.json`.
