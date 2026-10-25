# Espace documents

Page statique protégée par mot de passe, hébergée sur GitHub Pages.
Le contenu (`vault.json`) est chiffré localement avant publication et déchiffré
uniquement dans le navigateur. Il n'y a ni serveur, ni API, ni service externe, ni suivi.

## Fonctionnement

- **Chiffrement** : AES-256-GCM. La clé est dérivée de la phrase secrète par PBKDF2-SHA256
  (600 000 itérations, sel aléatoire). Le sel et les IV changent à chaque génération.
- **Données en clair** : uniquement dans `private/`, qui est ignoré par Git et n'est jamais publié.
- **noindex** : la page demande aux moteurs de ne pas l'indexer. Ce n'est **pas** une protection :
  le dépôt et `vault.json` sont publics, et seule la phrase secrète protège le contenu.
  Choisissez une phrase longue (au moins 4 ou 5 mots au hasard), car `vault.json` peut être téléchargé
  et attaqué hors ligne.

## Contenu de `private/` (non publié)

```
private/
  CV_xxx.docx           # CV original, chiffré tel quel (octets identiques)
  CV_xxx.pdf            # facultatif : s'il est présent, un bouton PDF apparaît
  mails/
    1-xxx.txt           # "Titre: ...", "Objet: ...", une ligne vide, puis le message
    2-xxx.txt
```

## Commandes (Windows, PowerShell, depuis le dossier du projet)

```powershell
# 1. Chiffrement (demande la phrase secrète, puis produit vault.json)
node tools\build.mjs

# 2. Vérification : aucune donnée en clair suivie par Git ni dans l'historique
node tools\check.mjs

# 3. Publication
git add .
git status
git commit -m "Mise à jour du contenu chiffré"
git push
```

Pour tester en local : `python -m http.server 8000`, puis ouvrez http://localhost:8000
(pas en double-cliquant sur `index.html` : le navigateur bloque alors le chargement de `vault.json`).
