/**
 * Chargement du jeu de donnees NF C 15-100.
 *
 * Arborescence attendue (dossier partage, hors depot) :
 *   <dossier nfc15100>/actif.json            { "jeu": "2024.1" }
 *   <dossier nfc15100>/jeux/<jeu>/manifest.json
 *   <dossier nfc15100>/jeux/<jeu>/*.json
 *
 * Le dossier nfc15100 vaut NEXUS_NFC_DIR s'il est defini, sinon <dataDir>/nfc15100.
 * Un jeu publie est fige : chaque fichier est controle contre la somme SHA-256 du manifeste.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const FICHIERS = [
  'sources.json',
  'methodes_pose.json',
  'iz_admissible.json',
  'facteurs_correction.json',
  'facteurs_particuliers.json',
  'section_neutre.json',
  'resistivites.json',
  'chute_tension_regles.json',
  'chute_tension_tableaux.json',
  'courant_protection.json',
  'transformateurs.json',
  'condensateurs.json',
]

const NOM_JEU = /^[0-9A-Za-z][0-9A-Za-z._-]{0,40}$/

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, ''))
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function createStore(getNfcDir) {
  const cache = new Map() // jeu -> { signature, data }

  function nfcDir() {
    const dir = getNfcDir()
    if (!dir || !fs.existsSync(dir)) {
      throw new Error(`Donnees NF C 15-100 introuvables (${dir || 'dossier non defini'}). Le module n'est pas installe sur ce dossier de donnees.`)
    }
    return dir
  }

  function jeuActif() {
    const file = path.join(nfcDir(), 'actif.json')
    if (!fs.existsSync(file)) throw new Error(`Aucun jeu de donnees publie : ${file} absent.`)
    const actif = readJson(file)
    if (!actif.jeu) throw new Error('actif.json ne designe aucun jeu.')
    return actif.jeu
  }

  function listeJeux() {
    const dir = path.join(nfcDir(), 'jeux')
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'manifest.json'))).sort()
  }

  /** Charge un jeu (le jeu actif par defaut). Recharge si le manifeste change. */
  function charger(jeu) {
    const nom = jeu || jeuActif()
    if (!NOM_JEU.test(nom)) throw new Error(`Nom de jeu invalide : ${nom}`)
    const dir = path.join(nfcDir(), 'jeux', nom)
    const manifestFile = path.join(dir, 'manifest.json')
    if (!fs.existsSync(manifestFile)) {
      throw new Error(`Jeu de donnees ${nom} introuvable. Jeux disponibles : ${listeJeux().join(', ') || 'aucun'}.`)
    }
    const stat = fs.statSync(manifestFile)
    const signature = `${stat.mtimeMs}:${stat.size}`
    const hit = cache.get(nom)
    if (hit && hit.signature === signature) return hit.data

    const manifest = readJson(manifestFile)
    const data = { jeu: nom, manifest, dir }
    for (const name of FICHIERS) {
      const file = path.join(dir, name)
      if (!fs.existsSync(file)) throw new Error(`Jeu ${nom} incomplet : ${name} manquant.`)
      const attendu = manifest.fichiers?.[name]
      if (!attendu) throw new Error(`Jeu ${nom} : ${name} absent du manifeste.`)
      if (sha256(file) !== attendu) {
        throw new Error(`Jeu ${nom} : ${name} a ete modifie apres publication (somme de controle differente). Republier le jeu.`)
      }
      data[name.replace(/\.json$/, '')] = readJson(file)
    }
    cache.set(nom, { signature, data })
    return data
  }

  return { charger, jeuActif, listeJeux, nfcDir }
}

module.exports = { createStore, FICHIERS, sha256 }
