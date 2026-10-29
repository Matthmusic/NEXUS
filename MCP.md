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
| `nexus_cable_price` | Prix posé d'un câble : achat × marge + temps de pose × taux, total pour une quantité |
| `nexus_update_price` | *(optionnel)* Modifie le prix d'une référence — voir « Écriture » plus bas |
| `nexus_upsert_items` | *(optionnel)* Intègre des prix en masse : ajoute les nouvelles références, met à jour les existantes, avec mode simulation (`dryRun`) |

## Branchement dans Claude Desktop

Ouvrir **Paramètres → Développeur → Modifier la config** (`%APPDATA%\Claude\claude_desktop_config.json`) et ajouter :

### Option A — avec NEXUS installé (pas besoin de Node)

L'exécutable NEXUS sait se lancer en mode Node grâce à `ELECTRON_RUN_AS_NODE` :

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

(Remplacer `<VOUS>` par votre nom d'utilisateur Windows, ou adapter si NEXUS est installé ailleurs.)

### Option B — depuis le code source (Node installé)

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

## Écriture (désactivée par défaut)

Pour autoriser Claude à modifier ou intégrer des prix, ajouter dans `env` :

```json
"env": { "NEXUS_MCP_ALLOW_WRITE": "1", "NEXUS_MCP_USER": "Matthieu (Claude)" }
```

Exemple : « voici le tarif Schneider 2027 (fichier joint), intègre-le dans NEXUS ». Claude lit le fichier, appelle `nexus_upsert_items` en simulation pour montrer ce qui sera ajouté ou modifié, puis écrit après ton accord. Pour une référence existante, seuls les champs fournis changent ; une nouvelle référence doit avoir au moins un libellé et un prix.

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
