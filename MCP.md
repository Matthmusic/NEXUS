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

## Branchement dans Claude Desktop

### Automatique (NEXUS 0.1.3 et plus)

Rien à faire : au lancement, NEXUS s'inscrit tout seul dans la config de Claude Desktop (`%APPDATA%\Claude\claude_desktop_config.json`, ou la version Microsoft Store). Il suffit ensuite de **redémarrer Claude Desktop** une fois.

- Seule l'entrée `nexus` est ajoutée ou mise à jour ; les autres serveurs MCP et réglages restent intacts, et une copie `.bak` est faite avant toute modification.
- Les variables ajoutées à la main dans `env` (ex. `NEXUS_MCP_USER`) sont conservées.
- Si Claude Desktop n'est pas installé, rien n'est fait.
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
