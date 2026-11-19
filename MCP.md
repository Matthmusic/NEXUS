# NEXUS en serveur MCP

NEXUS inclut un serveur MCP (`electron/mcp-server.cjs`) qui donne à Claude (Claude Desktop, Claude Code…) accès à la base de prix. Il lit le même `prices.json` que l'application, donc les prix sont toujours à jour.

## Outils exposés

| Outil | Rôle |
|---|---|
| `nexus_search` | Recherche floue (même moteur que l'app) avec filtres catégorie / fournisseur |
| `nexus_get_item` | Fiche complète d'une référence, historique des prix compris |
| `nexus_get_items` | Prix de plusieurs références d'un coup (chiffrage d'une liste) |
| `nexus_overview` | Infos base : nb d'articles, catégories, fournisseurs, verrou admin en cours |
| `nexus_cable_types` | Types de câbles et sections disponibles (comme le Calculateur) |
| `nexus_cable_price` | Prix posé d'un câble ou d'une liaison multi-câbles (ex. `4x3x1x240 + PE 240`) : achat × marge + temps de pose × taux, total pour une longueur. Temps de pose estimé par formule si la section n'est pas dans le tableau |
| `nexus_update_price` | *(optionnel)* Modifie le prix d'une référence — voir « Écriture » plus bas |
| `nexus_upsert_items` | *(optionnel)* Intègre des prix en masse : ajoute les nouvelles références, met à jour les existantes, avec mode simulation (`dryRun`) |
| `nexus_delete_items` | *(optionnel)* Supprime des références (50 max par appel), avec mode simulation (`dryRun`) |

## Module NF C 15-100 (outils `nexus_nfc_*`)

Outils en lecture seule pour dimensionner les canalisations BT selon la NF C 15-100. Les calculs sont faits par le serveur ; chaque réponse donne le résultat, les étapes du calcul, les références (tableau, page de la source, édition), les avertissements et l'état de vérification des données utilisées.

| Outil | Rôle |
|---|---|
| `nexus_nfc_section_minimale` | Section minimale selon IB, la protection, le mode de pose, la température, le groupement, les câbles en parallèle, le neutre chargé, BE3. Renvoie aussi `pour_chiffrage`, à passer à `nexus_cable_price` |
| `nexus_nfc_courant_admissible` | Iz corrigé d'une section dans des conditions de pose données |
| `nexus_nfc_facteurs_correction` | Facteur global K et son détail |
| `nexus_nfc_chute_tension` | Chute de tension (formule UTE C 15-105), cumul amont, limite, contrôle par le tableau V/A/km, démarrage moteur |
| `nexus_nfc_longueur_max` | Longueur maximale pour une chute de tension admissible |
| `nexus_nfc_section_neutre` | Règle de section du neutre selon les harmoniques |
| `nexus_nfc_mode_pose` | Trouve le mode de pose et la méthode de référence à partir d'une description |
| `nexus_nfc_tableau` | Consultation brute d'un tableau (pour vérifier une valeur) |
| `nexus_nfc_transformateur` | Caractéristiques d'un transformateur HTA/BT |
| `nexus_nfc_a_propos` | Jeu de données actif, sources, taux de vérification |

### Données

Les valeurs normatives **ne sont pas dans ce dépôt** (dépôt public, tableaux soumis à la licence AFNOR). Elles sont lues dans `<dossier de données>\nfc15100\` (ou `NEXUS_NFC_DIR`) :

```
nfc15100\
  actif.json                 jeu utilisé par défaut, ex. { "jeu": "2024.1" }
  jeux\2024.1\manifest.json  sommes SHA-256 de chaque fichier
  jeux\2024.1\*.json         tableaux, facteurs, règles
```

Un jeu publié est figé : un fichier modifié à la main est refusé par le serveur. Pour corriger, copier le jeu sous un nouveau nom (`2024.2`), corriger, puis :

```bash
node scripts/nfc15100/controler.cjs "Z:\F - UTILITAIRES\NEXUS\nfc15100\jeux\2024.2" rapport.md
node scripts/nfc15100/publier.cjs "Z:\F - UTILITAIRES\NEXUS\nfc15100" 2024.2 --actif --auteur "Nom"
```

Sans dossier `nfc15100`, les outils répondent simplement que le module n'est pas installé ; le reste de NEXUS fonctionne normalement.

## Branchement dans Claude Desktop

### Automatique (NEXUS 0.1.3 et plus)

Rien à faire : au lancement, NEXUS s'inscrit tout seul dans la config de Claude Desktop (`%APPDATA%\Claude\claude_desktop_config.json`, ou la version Microsoft Store). Il suffit ensuite de **redémarrer Claude Desktop** une fois.

- Seule l'entrée `nexus` est ajoutée ou mise à jour ; les autres serveurs MCP et réglages restent intacts, et une copie `.bak` est faite avant toute modification.
- Les variables ajoutées à la main dans `env` (ex. `NEXUS_MCP_USER`) sont conservées.
- Si Claude Desktop n'est pas installé, rien n'est fait.
- Pendant une mise à jour de NEXUS, le serveur MCP s'arrête tout seul pour laisser l'installeur remplacer les fichiers. Redémarrer Claude Desktop après la mise à jour pour le relancer.
- Pour désactiver : ajouter `"mcpAutoRegister": false` dans `%APPDATA%\nexus\config.json`.

### Manuel — avec NEXUS installé (pas besoin de Node)

Ce que fait l'inscription automatique. L'exécutable NEXUS sait se lancer en mode Node grâce à `ELECTRON_RUN_AS_NODE` :

```json
{
  "mcpServers": {
    "nexus": {
      "command": "C:\\Users\\<VOUS>\\AppData\\Local\\Programs\\nexus\\NEXUS.exe",
      "args": ["C:\\Users\\<VOUS>\\AppData\\Local\\Programs\\nexus\\resources\\app.asar\\electron\\mcp-server.cjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

### Manuel — depuis le code source (Node installé)

```json
{
  "mcpServers": {
    "nexus": {
      "command": "node",
      "args": ["C:\\chemin\\vers\\NEXUS\\electron\\mcp-server.cjs"]
    }
  }
}
```

(Faire `npm install` dans le dossier avant.)

### Claude Code

```bash
claude mcp add nexus -- node /chemin/vers/NEXUS/electron/mcp-server.cjs
```

Redémarrer Claude : les outils `nexus_*` apparaissent.

## Dossier de données

Par ordre de priorité :
1. Variable `NEXUS_DATA_DIR` (dans `env` de la config MCP)
2. `dataDir` du `config.json` de l'app (`%APPDATA%\nexus\config.json`) — donc le même dossier que NEXUS
3. Par défaut `Z:\F - UTILITAIRES\NEXUS`

## Écriture (activée par défaut depuis 0.1.5)

Claude peut ajouter, modifier et supprimer des références sur tous les postes. L'auteur enregistré est le nom de session Windows suivi de « (Claude) », par exemple `matthieu.maurel (Claude)`.

Pour changer le nom ou désactiver l'écriture sur un poste, ajouter dans `env` de l'entrée `nexus` :

```json
"env": { "NEXUS_MCP_USER": "Matthieu (Claude)", "NEXUS_MCP_ALLOW_WRITE": "0" }
```

Exemple : « voici le tarif Schneider 2027 (fichier joint), intègre-le dans NEXUS ». Claude lit le fichier, appelle `nexus_upsert_items` en simulation pour montrer ce qui sera ajouté ou modifié, puis écrit après ton accord. Pour une référence existante, seuls les champs fournis changent ; une nouvelle référence doit avoir au moins un libellé et un prix.

Pour supprimer : « supprime la référence TEST-001 de NEXUS ». Claude montre d'abord la liste de ce qui sera supprimé (simulation), puis supprime après ton accord. Une base supprimée par erreur se restaure depuis la sauvegarde faite juste avant dans `backups/`.

Chaque écriture :
- prend le verrou admin le temps de l'écriture et **échoue si quelqu'un est admin dans NEXUS** ;
- crée une sauvegarde dans `backups/` ;
- ajoute l'ancien prix à l'historique, avec `NEXUS_MCP_USER` comme auteur ;
- est tracée dans `admin.log` ;
- met à jour `prices.ver` pour que les NEXUS ouverts rechargent la base.

## Test rapide

```bash
npx @modelcontextprotocol/inspector node electron/mcp-server.cjs
```
