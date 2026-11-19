#!/usr/bin/env node
/**
 * Fige un jeu de donnees nfc15100 (manifeste + sommes SHA-256) et, en option,
 * le declare comme jeu actif.
 *
 * Usage : node scripts/nfc15100/publier.cjs <dossier nfc15100> <jeu> [--actif] [--auteur "Nom"] [--statut brouillon|publie]
 *   <dossier nfc15100> contient jeux/<jeu>/ (ex. Z:\F - UTILITAIRES\NEXUS\nfc15100)
 *
 * Un jeu deja publie (statut "publie") n'est jamais reecrit : creer le jeu suivant.
 */
const fs = require('fs')
const path = require('path')
const { FICHIERS, sha256 } = require('../../electron/nfc15100/donnees.cjs')
const pkg = require('../../package.json')

const args = process.argv.slice(2)
const [root, jeu] = args
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
if (!root || !jeu) {
  console.error('Usage : node publier.cjs <dossier nfc15100> <jeu> [--actif] [--auteur "Nom"] [--statut brouillon|publie]')
  process.exit(1)
}
const dir = path.join(root, 'jeux', jeu)
const manifestFile = path.join(dir, 'manifest.json')
if (fs.existsSync(manifestFile)) {
  const old = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'))
  if (old.statut === 'publie') {
    console.error(`Le jeu ${jeu} est deja publie et fige. Creer un nouveau jeu (copie + corrections).`)
    process.exit(2)
  }
}
const fichiers = {}
let total = 0
let verifiees = 0
for (const name of FICHIERS) {
  const file = path.join(dir, name)
  if (!fs.existsSync(file)) { console.error(`Fichier manquant : ${file}`); process.exit(1) }
  fichiers[name] = sha256(file)
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
  const blocs = [data, ...(data.tableaux || []), ...(data.unitaire ? [data.unitaire, data.demarrage_k2] : [])]
  for (const b of blocs) for (const l of b.lignes || []) { total += 1; if (l.verif === 'verifie') verifiees += 1 }
}
const sources = JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf-8'))
const manifest = {
  jeu,
  edition_norme: sources.sources.find((s) => s.edition_norme)?.edition_norme || null,
  statut: opt('--statut') || 'brouillon',
  publie_le: new Date().toISOString(),
  publie_par: opt('--auteur') || process.env.USERNAME || process.env.USER || 'inconnu',
  nexus_min_version: pkg.version,
  verification: { valeurs: total, verifiees },
  fichiers,
}
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Manifeste ecrit : ${manifestFile} (${verifiees}/${total} valeurs verifiees, statut ${manifest.statut})`)
if (args.includes('--actif')) {
  fs.writeFileSync(path.join(root, 'actif.json'), `${JSON.stringify({ jeu, publie_le: manifest.publie_le, publie_par: manifest.publie_par }, null, 2)}\n`)
  console.log(`Jeu actif : ${jeu}`)
}
