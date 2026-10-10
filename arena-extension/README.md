# 💾 Arena Saver — Sauvegarde les fichiers créés par l'IA

Extension pour **Microsoft Edge** (fonctionne aussi sur Chrome) qui détecte
automatiquement les **fichiers et blocs de code créés par l'agent Arena**
sur [`arena.ai/agent`](https://arena.ai/agent), et les sauvegarde **dans ton
dossier à toi** (ex : `Documents`), avec tout le code dedans.

Pas de serveur, pas de compte, pas de Native Host à installer : tout se passe
dans le navigateur.

---

## ✨ Ce que ça fait

- 🔎 **Détecte automatiquement** chaque bloc de code / fichier produit par l'IA,
  même pendant qu'elle écrit (re-scan en continu).
- 📝 **Devine le nom du fichier** : titre du bloc, attributs de la page,
  première ligne commentée (`# app.py`, `// server.js`), ou nom numéroté
  (`arena-python-01.py`) sinon. Tu peux **renommer** chaque fichier avant de
  sauvegarder (les sous-dossiers comme `src/app.py` sont autorisés).
- 📁 **Écrit directement dans ton dossier** : tu choisis ton dossier
  `Documents` (ou un sous-dossier) **une seule fois**, il est mémorisé.
  Ensuite : un clic = tous les fichiers sauvegardés, avec l'arborescence.
- 💾 **Bouton 💾 sur chaque bloc de code** pour sauvegarder un seul fichier.
- 🗜️ **Export ZIP** en un clic (pratique pour tout récupérer d'un coup ou si
  l'écriture directe est refusée).
- 🔗 Détecte aussi les **pièces jointes / liens de téléchargement** de la page.
- 🧹 Le contenu sauvegardé est **propre** : boutons « Copier », numéros de
  ligne et éléments d'interface exclus, code exact préservé.

## 🚀 Installation dans Edge (2 minutes)

1. Télécharge ce dépôt (bouton vert **Code → Download ZIP** sur GitHub) puis
   décompresse-le, ou clone-le :
   ```
   git clone https://github.com/azgmail21-eng/az.git
   ```
2. Ouvre `edge://extensions` dans Edge.
3. Active le **Mode développeur** (en bas à gauche).
4. Clique sur **Charger l'extension décompressée** et sélectionne le dossier
   **`arena-extension/`** (celui qui contient `manifest.json`).
5. C'est tout — l'icône 💾 apparaît dans la barre d'outils.

> À chaque mise à jour du code, clique sur **🔄 Recharger** sur la carte de
> l'extension dans `edge://extensions`.

## 🖱️ Utilisation

1. Va sur `https://arena.ai/agent` et discute avec l'agent.
2. Dès que l'IA produit du code, un panneau **💾 Arena Saver** apparaît en bas
   à droite avec la liste des fichiers détectés.
3. Clique sur **Choisir…** et sélectionne ton dossier (ex : `Documents`
   ou `Documents\Arena`). Edge demande une autorisation : **accepte**.
   Le dossier est mémorisé, tu ne le referas plus.
4. Renomme les fichiers si besoin (champ modifiable), coche ceux que tu veux,
   puis clique sur **⬇ Tout sauvegarder**.
5. Tes fichiers sont dans ton dossier, avec tout le code dedans. 🎉

**Alternatives :**
- Bouton **💾** en haut à droite de chaque bloc de code = sauvegarder juste
  celui-là.
- Bouton **ZIP ⬇** = tout télécharger en un seul fichier `.zip` (dans ton
  dossier Téléchargements).
- Clic sur l'icône de l'extension = popup avec résumé + actions rapides.

## 🔍 Comment les noms de fichiers sont trouvés

Par ordre de priorité, pour chaque bloc :

1. Attributs de la page (`data-filename`, `title`, …)
2. Titre / en-tête affiché au-dessus du bloc (`app.py`, `src/index.js`, …)
3. Première ligne du code si c'est juste un nom (`# app.py`, `// server.js`)
4. Sinon : `arena-<langage>-<numéro>.<extension>` (badge ✏️ = à renommer)

En cas de doublon : `app.py`, `app (2).py`, … Les caractères interdits par
Windows (`< > : " | ? *`) sont remplacés automatiquement.

## 🔐 Autorisations demandées (et pourquoi)

| Autorisation | Pourquoi |
|---|---|
| Accès à `arena.ai` / `lmarena.ai` | Lire les réponses de l'agent pour détecter le code (uniquement sur ces sites) |
| `storage` | Mémoriser que le dossier a été choisi |
| `downloads` | Télécharger l'export ZIP |

L'écriture dans ton dossier passe par le sélecteur de dossier d'Edge :
**c'est toi qui choisis le dossier, et Edge te demande ton accord**.
L'extension ne peut écrire nulle part ailleurs. Tout le code est lisible dans
ce dossier (`detect.js`, `content.js`, …) — rien n'est envoyé sur internet.

## 🛟 Dépannage

- **Le panneau n'apparaît pas** : recharge la page (F5). Vérifie que
  l'extension est activée dans `edge://extensions`.
- **« Choisir… » ne fait rien depuis la popup** : normal, Edge exige un clic
  *dans la page*. Utilise le bouton **Choisir…** du panneau en bas à droite
  de la page Arena.
- **« Autorisation à renouveler »** : Edge a oublié l'autorisation (redémarrage,
  mise à jour…). Re-clique sur **Choisir…** et re-sélectionne le même dossier.
- **Le sélecteur de dossier ne s'ouvre pas du tout** : utilise le bouton
  **ZIP ⬇** à la place (aucune autorisation requise).
- **Un fichier a un mauvais nom** : renomme-le dans le champ avant de
  sauvegarder, ou signale le cas (copie d'écran du bloc) pour améliorer la
  détection.

## 🛠️ Développement

```bash
npm install   # installe jsdom + jszip, vendorise JSZip dans vendor/
npm test      # 11 tests de détection (jsdom)
npm run icons # régénère les icônes PNG
```

Structure :

```
arena-extension/
├── manifest.json      # Manifest V3 (Edge/Chrome)
├── detect.js          # Détection + noms de fichiers (pur DOM, testé)
├── content.js         # Panneau, sauvegarde, ZIP, boutons 💾
├── content.css        # Styles du panneau
├── popup.html/js      # Popup de la barre d'outils
├── background.js      # Service worker (téléchargements de secours)
├── vendor/jszip.min.js# ZIP hors-ligne (copié depuis npm)
└── icons/             # Icônes générées (tools/make-icons.mjs)
```
