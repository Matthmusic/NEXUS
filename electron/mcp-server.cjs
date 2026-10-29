#!/usr/bin/env node
/**
 * NEXUS — serveur MCP (stdio)
 *
 * Expose la base de prix NEXUS a un client MCP (Claude Desktop, Claude Code...).
 * Lit les memes fichiers que l'application (prices.json dans le dossier de donnees).
 *
 * Lancement :
 *   node electron/mcp-server.cjs
 *   ou, sans Node installe, avec l'executable NEXUS :
 *   ELECTRON_RUN_AS_NODE=1 NEXUS.exe <...>/resources/app.asar/electron/mcp-server.cjs
 *
 * Variables d'environnement :
 *   NEXUS_DATA_DIR         Dossier de donnees (sinon lu depuis config.json de l'app)
 *   NEXUS_MCP_ALLOW_WRITE  "0" pour desactiver les outils d'ecriture (actives par defaut)
 *   NEXUS_MCP_USER         Nom inscrit dans l'historique / le verrou (defaut : "MCP")
 *
 * Important : stdout est reserve au protocole MCP, les logs vont sur stderr.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const FuseModule = require('fuse.js')
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')

const Fuse = FuseModule.default || FuseModule
const pkg = require('../package.json')

const ALLOW_WRITE = process.env.NEXUS_MCP_ALLOW_WRITE !== '0'
function defaultMcpUser() {
  try { return `${os.userInfo().username} (Claude)` } catch { return 'MCP' }
}
const MCP_USER = (process.env.NEXUS_MCP_USER || '').trim() || defaultMcpUser()

function log(...args) {
  console.error('[NEXUS-MCP]', ...args)
}

// ---------------------------------------------------------------------------
// Dossier de donnees : meme logique que electron/main.cjs
// ---------------------------------------------------------------------------

function appDataRoot() {
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support')
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''))
  } catch (error) {
    log('lecture JSON impossible', filePath, error.message)
    return fallback
  }
}

function loadAppConfig() {
  // userData d'Electron = %APPDATA%/<nom de l'app> (insensible a la casse sous Windows)
  for (const name of ['NEXUS', 'nexus']) {
    const cfg = readJsonSafe(path.join(appDataRoot(), name, 'config.json'), null)
    if (cfg) return cfg
  }
  return {}
}

function resolveDataDir() {
  if (process.env.NEXUS_DATA_DIR) return process.env.NEXUS_DATA_DIR
  const cfg = loadAppConfig()
  if (cfg.dataDir) return cfg.dataDir
  return process.platform === 'win32'
    ? 'Z:\\F - UTILITAIRES\\NEXUS'
    : path.join(__dirname, '..', 'data')
}

function lockTimeoutMin() {
  const value = Number(loadAppConfig().lockTimeoutMin)
  return Number.isFinite(value) && value > 0 ? value : 10
}

const paths = {
  get dir() { return resolveDataDir() },
  get prices() { return path.join(this.dir, 'prices.json') },
  get lock() { return path.join(this.dir, 'prices.lock') },
  get log() { return path.join(this.dir, 'admin.log') },
  get version() { return path.join(this.dir, 'prices.ver') },
  get backups() { return path.join(this.dir, 'backups') },
}

// ---------------------------------------------------------------------------
// Base de prix (rechargee si le fichier change)
// ---------------------------------------------------------------------------

let cache = { mtimeMs: -1, file: '', db: null, fuse: null, fuseCompact: null, searchable: [] }

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function compactText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function loadDb() {
  const file = paths.prices
  if (!fs.existsSync(file)) {
    throw new Error(`Base introuvable : ${file}. Definir NEXUS_DATA_DIR ou verifier le dossier configure dans NEXUS.`)
  }
  const { mtimeMs } = fs.statSync(file)
  if (cache.db && cache.file === file && cache.mtimeMs === mtimeMs) return cache

  const db = readJsonSafe(file, null)
  if (!db || !Array.isArray(db.items)) throw new Error(`Base illisible : ${file}`)

  const searchable = db.items.map((item) => ({
    item,
    searchRef: normalizeText(item.ref),
    searchName: normalizeText(item.name),
    searchKeywords: normalizeText((item.keywords || []).join(' ')),
    searchCategory: normalizeText(item.category),
    searchSupplier: normalizeText(item.supplier),
    searchRefCompact: compactText(item.ref),
    searchNameCompact: compactText(item.name),
  }))

  // Memes reglages que la recherche de l'app (src/App.tsx)
  const fuse = new Fuse(searchable, {
    keys: [
      { name: 'searchRef', weight: 2 },
      { name: 'searchName', weight: 1.5 },
      { name: 'searchKeywords', weight: 0.8 },
      { name: 'searchCategory', weight: 0.5 },
      { name: 'searchSupplier', weight: 0.5 },
    ],
    threshold: 0.25,
    distance: 140,
    minMatchCharLength: 2,
    ignoreLocation: true,
    includeScore: true,
  })
  const fuseCompact = new Fuse(searchable, {
    keys: [
      { name: 'searchRefCompact', weight: 2 },
      { name: 'searchNameCompact', weight: 1 },
    ],
    threshold: 0.35,
    distance: 100,
    minMatchCharLength: 2,
    ignoreLocation: true,
    includeScore: true,
  })

  cache = { mtimeMs, file, db, fuse, fuseCompact, searchable }
  log(`base chargee : ${db.items.length} articles (${file})`)
  return cache
}

function searchItems(query, { category, supplier, limit }) {
  const { searchable, fuse, fuseCompact } = loadDb()
  const q = normalizeText(query)
  const qc = compactText(query)
  let found

  if (!q && !qc) {
    found = searchable.map((s) => ({ item: s.item, score: null }))
  } else if (qc.length < 3) {
    found = searchable
      .filter((s) => s.searchRef.includes(q) || s.searchName.includes(q)
        || s.searchRefCompact.includes(qc) || s.searchNameCompact.includes(qc))
      .map((s) => ({ item: s.item, score: null }))
  } else {
    const best = new Map()
    for (const r of [...fuse.search(q), ...fuseCompact.search(qc)]) {
      const prev = best.get(r.item.item.ref)
      if (!prev || r.score < prev.score) best.set(r.item.item.ref, { item: r.item.item, score: r.score })
    }
    found = [...best.values()].sort((a, b) => a.score - b.score)
  }

  const cat = category ? normalizeText(category) : ''
  const sup = supplier ? normalizeText(supplier) : ''
  if (cat) found = found.filter((r) => normalizeText(r.item.category).includes(cat))
  if (sup) found = found.filter((r) => normalizeText(r.item.supplier).includes(sup))

  return { total: found.length, results: found.slice(0, limit) }
}

function summarize(item, score) {
  const out = {
    ref: item.ref,
    name: item.name,
    price: item.price,
    unit: item.unit || '',
    category: item.category || '',
    supplier: item.supplier || '',
  }
  if (item.updatedAt) out.updatedAt = item.updatedAt
  if (score !== null && score !== undefined) out.score = Number(score.toFixed(3))
  return out
}

function findByRef(ref) {
  const { db } = loadDb()
  const target = String(ref || '').trim().toLowerCase()
  return db.items.find((item) => String(item.ref).toLowerCase() === target) || null
}

// ---------------------------------------------------------------------------
// Calculateur cables (reprend src/components/calc/cableData.ts et CableCalculator.tsx)
// ---------------------------------------------------------------------------

const CABLE_CATS = [
  'Câbles industriels rigides', 'Câbles incendie', 'Moyenne tension',
  'Fils et câbles souples', 'Domestique rigide', 'Câbles Spéciaux',
  'Câbles alarmes', 'Câbles téléphoniques',
]
const SECTION_RE = / (\d+[gGxXjJ]\d+[,.]?\d*)/
const COND_RE = /\s+(TGL|T500|T250|T100|C50|C100|FUT)\b/i
const DEFAULT_MARGE = 1.4
const DEFAULT_TAUX = 50

let cablesSpecs = null
function loadCableSpecs() {
  if (cablesSpecs) return cablesSpecs
  cablesSpecs = readJsonSafe(path.join(__dirname, '..', 'src', 'assets', 'cables.json'), [])
  return cablesSpecs
}

function normalizeSection(s) {
  return String(s || '').toLowerCase().replace(',', '.').replace(/\s/g, '')
}

function buildCableTypeMap() {
  const { db } = loadDb()
  const map = {}
  for (const item of db.items) {
    if (item.unit !== 'm' || !CABLE_CATS.includes(item.category || '')) continue
    const match = String(item.name).match(SECTION_RE)
    if (!match) continue
    const type = item.name.substring(0, item.name.indexOf(match[0])).trim()
    if (!type) continue
    const section = match[1].toUpperCase().replace('.', ',')
    if (!map[type]) map[type] = {}
    if (!map[type][section]) map[type][section] = []
    map[type][section].push(item)
  }
  return map
}

function findMapKey(obj, wanted) {
  const target = normalizeText(wanted)
  const keys = Object.keys(obj)
  return keys.find((k) => normalizeText(k) === target)
    || keys.find((k) => normalizeSection(k) === normalizeSection(wanted))
    || null
}

// ---------------------------------------------------------------------------
// Ecriture (optionnelle) — respecte le verrou admin de l'application
// ---------------------------------------------------------------------------

function appendAdminLog(entry) {
  try { fs.appendFileSync(paths.log, `${JSON.stringify(entry)}\n`) } catch (error) { log('admin.log', error.message) }
}

function acquireLock() {
  const now = new Date().toISOString()
  const existing = readJsonSafe(paths.lock, null)
  if (existing) {
    const hb = new Date(existing.heartbeat || 0).getTime()
    const stale = Number.isFinite(hb) && Date.now() - hb > lockTimeoutMin() * 60 * 1000
    if (!stale) {
      throw new Error(`Base verrouillee par ${existing.user} (${existing.machine || '?'}) — modification impossible pour l'instant.`)
    }
    appendAdminLog({ timestamp: now, action: 'expired', user: existing.user, machine: existing.machine })
    fs.unlinkSync(paths.lock)
  }
  const lock = { user: MCP_USER, machine: os.hostname(), pid: process.pid, since: now, heartbeat: now }
  const fd = fs.openSync(paths.lock, 'wx')
  fs.writeFileSync(fd, JSON.stringify(lock, null, 2))
  fs.closeSync(fd)
  appendAdminLog({ timestamp: now, action: 'lock', user: MCP_USER, machine: lock.machine, via: 'mcp' })
}

function releaseLock() {
  const lock = readJsonSafe(paths.lock, null)
  if (lock && lock.user === MCP_USER && lock.pid === process.pid) {
    fs.unlinkSync(paths.lock)
    appendAdminLog({ timestamp: new Date().toISOString(), action: 'unlock', user: MCP_USER, machine: os.hostname(), via: 'mcp' })
  }
}

// Prend le verrou, sauvegarde, applique `mutate(db, now)` puis ecrit de facon atomique.
function writeDb(mutate) {
  acquireLock()
  try {
    const db = readJsonSafe(paths.prices, null)
    if (!db || !Array.isArray(db.items)) throw new Error('Base illisible')
    const now = new Date().toISOString()
    const result = mutate(db, now)

    if (!fs.existsSync(paths.backups)) fs.mkdirSync(paths.backups, { recursive: true })
    const stamp = now.replace(/[:.]/g, '-').slice(0, 19)
    fs.copyFileSync(paths.prices, path.join(paths.backups, `prices-${stamp}.json`))

    db.meta = { ...db.meta, updatedAt: now, updatedBy: MCP_USER }
    const tmp = `${paths.prices}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2))
    fs.renameSync(tmp, paths.prices)
    try { fs.writeFileSync(paths.version, now) } catch { /* non bloquant */ }
    return result
  } finally {
    releaseLock()
  }
}

function withHistory(prev, nextPrice, now) {
  if (prev.price === nextPrice) return prev.history || []
  return [{ price: prev.price, updatedAt: prev.updatedAt || now, updatedBy: prev.updatedBy || 'inconnu' }, ...(prev.history || [])].slice(0, 10)
}

function findIndexByRef(items, ref) {
  const target = String(ref).trim().toLowerCase()
  return items.findIndex((item) => String(item.ref).toLowerCase() === target)
}

function updatePrice(ref, price) {
  return writeDb((db, now) => {
    const idx = findIndexByRef(db.items, ref)
    if (idx < 0) throw new Error(`Reference introuvable : ${ref}`)
    const prev = db.items[idx]
    db.items[idx] = { ...prev, price, updatedAt: now, updatedBy: MCP_USER, history: withHistory(prev, price, now) }
    return { before: prev.price, after: price, item: db.items[idx] }
  })
}

// Ajoute les nouvelles references et met a jour les existantes (champs fournis seulement).
// Meme normalisation que handleSave dans src/App.tsx.
function planUpsert(items, entries, now) {
  const report = { added: [], updated: [], unchanged: [] }
  const next = [...items]
  for (const entry of entries) {
    const ref = entry.ref.trim()
    const idx = findIndexByRef(next, ref)
    const clean = {}
    for (const key of ['name', 'unit', 'category', 'supplier']) {
      if (entry[key] !== undefined) clean[key] = String(entry[key]).trim()
    }
    if (entry.price !== undefined) clean.price = entry.price
    if (entry.keywords !== undefined) clean.keywords = entry.keywords.map((k) => k.trim()).filter(Boolean)

    if (idx < 0) {
      if (!clean.name) throw new Error(`Libelle (name) requis pour la nouvelle reference ${ref}`)
      if (clean.price === undefined) throw new Error(`Prix requis pour la nouvelle reference ${ref}`)
      const item = { ref, name: clean.name, unit: clean.unit || '', price: clean.price, category: clean.category || '',
        supplier: clean.supplier || '', keywords: clean.keywords || [], updatedAt: now, updatedBy: MCP_USER, history: [] }
      next.unshift(item)
      report.added.push({ ref, name: item.name, price: item.price })
      continue
    }

    const prev = next[idx]
    const changed = Object.keys(clean).filter((k) => JSON.stringify(prev[k] ?? '') !== JSON.stringify(clean[k]))
    if (changed.length === 0) { report.unchanged.push(prev.ref); continue }
    const price = clean.price ?? prev.price
    next[idx] = { ...prev, ...clean, price, updatedAt: now, updatedBy: MCP_USER, history: withHistory(prev, price, now) }
    report.updated.push({ ref: prev.ref, name: next[idx].name, changed, ...(changed.includes('price') ? { before: prev.price, after: price } : {}) })
  }
  return { next, report }
}

function upsertItems(entries, dryRun) {
  if (dryRun) {
    const { db } = loadDb()
    return { dryRun: true, ...planUpsert(db.items, entries, new Date().toISOString()).report }
  }
  return writeDb((db, now) => {
    const { next, report } = planUpsert(db.items, entries, now)
    db.items = next
    return { dryRun: false, ...report }
  })
}

const MAX_DELETE = 50

// Supprime des references. Les refs introuvables sont signalees, pas d'erreur.
function deleteItems(refs, dryRun) {
  const plan = (items) => {
    const wanted = new Set(refs.map((r) => String(r).trim().toLowerCase()).filter(Boolean))
    const deleted = items.filter((item) => wanted.has(String(item.ref).toLowerCase()))
    const found = new Set(deleted.map((item) => String(item.ref).toLowerCase()))
    const notFound = [...new Set(refs.map((r) => String(r).trim()))].filter((r) => r && !found.has(r.toLowerCase()))
    const kept = items.filter((item) => !wanted.has(String(item.ref).toLowerCase()))
    return { kept, report: { deleted: deleted.map((i) => ({ ref: i.ref, name: i.name, price: i.price, category: i.category, supplier: i.supplier })), notFound } }
  }
  if (dryRun) {
    const { db } = loadDb()
    return { dryRun: true, ...plan(db.items).report }
  }
  return writeDb((db, now) => {
    const { kept, report } = plan(db.items)
    db.items = kept
    if (report.deleted.length) {
      appendAdminLog({ timestamp: now, action: 'delete', user: MCP_USER, machine: os.hostname(), via: 'mcp', refs: report.deleted.map((i) => i.ref) })
    }
    return { dryRun: false, ...report }
  })
}

// ---------------------------------------------------------------------------
// Serveur MCP
// ---------------------------------------------------------------------------

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function fail(message) {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function safe(handler) {
  return async (args) => {
    try { return await handler(args || {}) } catch (error) { return fail(error.message || String(error)) }
  }
}

const server = new McpServer(
  { name: 'nexus', version: pkg.version },
  {
    instructions:
      'NEXUS : base de prix HT (EUR) de composants electriques. '
      + 'Utiliser nexus_search pour trouver une reference (recherche floue sur ref, libelle, mots-cles, categorie, fournisseur), '
      + 'nexus_get_item pour le detail et l\'historique, nexus_cable_price pour chiffrer un cable (materiel x marge + temps de pose x taux horaire).',
  },
)

server.registerTool('nexus_search', {
  title: 'Rechercher dans la base de prix',
  description: 'Recherche floue (insensible aux accents/separateurs) dans la base de prix NEXUS. Renvoie ref, libelle, prix HT, unite, categorie, fournisseur.',
  inputSchema: {
    query: z.string().describe('Texte recherche : reference, libelle, mot-cle... Vide = tout lister (avec filtres).'),
    category: z.string().optional().describe('Filtre sur la categorie (contient)'),
    supplier: z.string().optional().describe('Filtre sur le fournisseur (contient)'),
    limit: z.number().int().min(1).max(200).optional().describe('Nombre max de resultats (defaut 20, max 200)'),
  },
  annotations: { readOnlyHint: true },
}, safe(({ query, category, supplier, limit }) => {
  const { total, results } = searchItems(query, { category, supplier, limit: limit || 20 })
  return ok({ total, shown: results.length, results: results.map((r) => summarize(r.item, r.score)) })
}))

server.registerTool('nexus_get_item', {
  title: 'Detail d\'une reference',
  description: 'Fiche complete d\'une reference (correspondance exacte, insensible a la casse), avec mots-cles et historique des prix.',
  inputSchema: { ref: z.string().describe('Reference exacte') },
  annotations: { readOnlyHint: true },
}, safe(({ ref }) => {
  const item = findByRef(ref)
  if (!item) return fail(`Reference introuvable : ${ref}. Essayer nexus_search.`)
  return ok(item)
}))

server.registerTool('nexus_get_items', {
  title: 'Prix de plusieurs references',
  description: 'Renvoie le prix de plusieurs references exactes en une fois (pour chiffrer une liste).',
  inputSchema: { refs: z.array(z.string()).min(1).max(500).describe('Liste de references') },
  annotations: { readOnlyHint: true },
}, safe(({ refs }) => {
  const found = []
  const missing = []
  for (const ref of refs) {
    const item = findByRef(ref)
    if (item) found.push(summarize(item))
    else missing.push(ref)
  }
  return ok({ found, missing })
}))

server.registerTool('nexus_overview', {
  title: 'Vue d\'ensemble de la base',
  description: 'Metadonnees de la base (devise, type de prix, derniere mise a jour), nombre d\'articles, categories et fournisseurs avec leurs effectifs.',
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, safe(() => {
  const { db, file } = loadDb()
  const count = (key) => {
    const map = {}
    for (const item of db.items) {
      const value = item[key] || '(vide)'
      map[value] = (map[value] || 0) + 1
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, count: n }))
  }
  const lock = readJsonSafe(paths.lock, null)
  return ok({
    file,
    meta: db.meta,
    itemCount: db.items.length,
    categories: count('category'),
    suppliers: count('supplier'),
    adminLock: lock ? { user: lock.user, machine: lock.machine, since: lock.since } : null,
    writeEnabled: ALLOW_WRITE,
  })
}))

server.registerTool('nexus_cable_types', {
  title: 'Types et sections de cables',
  description: 'Liste les types de cables (ex. "U1000 R2V") et leurs sections disponibles dans la base, tels qu\'utilises par le calculateur.',
  inputSchema: { type: z.string().optional().describe('Si fourni, detaille les sections et references de ce type') },
  annotations: { readOnlyHint: true },
}, safe(({ type }) => {
  const map = buildCableTypeMap()
  if (!type) {
    return ok(Object.keys(map).sort().map((t) => ({ type: t, sections: Object.keys(map[t]) })))
  }
  const key = findMapKey(map, type)
  if (!key) return fail(`Type inconnu : ${type}. Types disponibles : ${Object.keys(map).sort().join(', ')}`)
  const sections = {}
  for (const [section, items] of Object.entries(map[key])) sections[section] = items.map((i) => summarize(i))
  return ok({ type: key, sections })
}))

server.registerTool('nexus_cable_price', {
  title: 'Chiffrer un cable',
  description: 'Calcule le prix pose d\'un cable au metre lineaire, comme le Calculateur de NEXUS : '
    + 'PT materiel = prix achat x marge ; PT pose = temps de pose (h/ml) x taux horaire ; prix pose = somme. '
    + 'Renvoie aussi le total pour la quantite demandee.',
  inputSchema: {
    type: z.string().describe('Type de cable, ex. "U1000 R2V" (voir nexus_cable_types)'),
    section: z.string().describe('Section, ex. "3G2,5" ou "5G16"'),
    ref: z.string().optional().describe('Reference precise (sinon la premiere hors conditionnement TGL/T500/...)'),
    marge: z.number().positive().optional().describe(`Coefficient de marge (defaut ${DEFAULT_MARGE})`),
    taux: z.number().nonnegative().optional().describe(`Taux horaire de pose EUR/h (defaut ${DEFAULT_TAUX})`),
    qty: z.number().nonnegative().optional().describe('Quantite en metres (defaut 1)'),
  },
  annotations: { readOnlyHint: true },
}, safe(({ type, section, ref, marge, taux, qty }) => {
  const map = buildCableTypeMap()
  const typeKey = findMapKey(map, type)
  if (!typeKey) return fail(`Type inconnu : ${type}. Voir nexus_cable_types.`)
  const sectionKey = findMapKey(map[typeKey], section)
  if (!sectionKey) return fail(`Section ${section} absente pour ${typeKey}. Sections : ${Object.keys(map[typeKey]).join(', ')}`)

  const items = map[typeKey][sectionKey]
  let item
  if (ref) {
    item = items.find((i) => i.ref.toLowerCase() === ref.trim().toLowerCase())
    if (!item) return fail(`Reference ${ref} absente pour ${typeKey} ${sectionKey}. Refs : ${items.map((i) => i.ref).join(', ')}`)
  } else {
    item = items.find((i) => !COND_RE.test(i.name)) || items[0]
  }

  const spec = loadCableSpecs().find((c) => normalizeSection(c.designation) === normalizeSection(sectionKey)) || null
  const m = marge ?? DEFAULT_MARGE
  const t = taux ?? DEFAULT_TAUX
  const q = qty ?? 1
  const ptMat = item.price * m
  const ptPose = spec ? spec.tps_pose * t : null
  const prixPose = ptPose !== null ? ptMat + ptPose : null
  const round = (v) => (v === null ? null : Math.round(v * 10000) / 10000)

  return ok({
    type: typeKey,
    section: sectionKey,
    ref: item.ref,
    name: item.name,
    prixAchat_eur_ml: item.price,
    marge: m,
    ptMateriel_eur_ml: round(ptMat),
    tpsPose_h_ml: spec ? spec.tps_pose : null,
    taux_eur_h: t,
    ptPose_eur_ml: round(ptPose),
    prixPose_eur_ml: round(prixPose),
    qty_m: q,
    total_eur: prixPose !== null ? round(prixPose * q) : null,
    note: spec ? undefined : 'Temps de pose inconnu pour cette section (absente de cables.json) : seul le materiel est chiffre.',
    alternatives: items.filter((i) => i !== item).map((i) => ({ ref: i.ref, name: i.name, price: i.price })),
  })
}))

if (ALLOW_WRITE) {
  server.registerTool('nexus_update_price', {
    title: 'Modifier un prix',
    description: `Met a jour le prix HT d'une reference existante. Prend le verrou admin le temps de l'ecriture (echoue si quelqu'un est admin dans NEXUS), `
      + `fait une sauvegarde, ajoute l'ancien prix a l'historique. Auteur enregistre : "${MCP_USER}".`,
    inputSchema: {
      ref: z.string().describe('Reference exacte'),
      price: z.number().nonnegative().describe('Nouveau prix HT en EUR'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, safe(({ ref, price }) => {
    const res = updatePrice(ref, price)
    return ok({ ref: res.item.ref, name: res.item.name, before: res.before, after: res.after })
  }))
  server.registerTool('nexus_upsert_items', {
    title: 'Integrer des prix',
    description: 'Ajoute de nouvelles references et/ou met a jour des references existantes en une seule fois (ex. integration d\'un tarif fournisseur). '
      + 'Pour une reference existante, seuls les champs fournis sont modifies ; pour une nouvelle, name et price sont obligatoires. '
      + 'Utiliser dryRun=true d\'abord pour montrer a l\'utilisateur ce qui sera ajoute/modifie, puis relancer avec dryRun=false apres son accord. '
      + `Prend le verrou admin le temps de l'ecriture, sauvegarde la base, alimente l'historique des prix. Auteur : "${MCP_USER}".`,
    inputSchema: {
      items: z.array(z.object({
        ref: z.string().min(1).describe('Reference'),
        name: z.string().optional().describe('Libelle (obligatoire si nouvelle reference)'),
        price: z.number().nonnegative().optional().describe('Prix HT en EUR (obligatoire si nouvelle reference)'),
        unit: z.string().optional().describe('Unite, ex. "u", "m"'),
        category: z.string().optional(),
        supplier: z.string().optional(),
        keywords: z.array(z.string()).optional(),
      })).min(1).max(5000),
      dryRun: z.boolean().optional().describe('true = simulation sans ecrire (defaut false)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, safe(({ items, dryRun }) => {
    const res = upsertItems(items, !!dryRun)
    return ok({
      dryRun: res.dryRun,
      counts: { added: res.added.length, updated: res.updated.length, unchanged: res.unchanged.length },
      added: res.added.slice(0, 100),
      updated: res.updated.slice(0, 100),
      unchanged: res.unchanged.slice(0, 100),
    })
  }))
  server.registerTool('nexus_delete_items', {
    title: 'Supprimer des references',
    description: `Supprime des references de la base (${MAX_DELETE} max par appel). `
      + 'Toujours appeler d\'abord avec dryRun=true et montrer la liste a l\'utilisateur, puis relancer avec dryRun=false seulement apres son accord explicite. '
      + `Prend le verrou admin le temps de l'ecriture, sauvegarde la base avant (restaurable depuis backups/), trace la suppression dans admin.log. Auteur : "${MCP_USER}".`,
    inputSchema: {
      refs: z.array(z.string().min(1)).min(1).max(MAX_DELETE).describe('References exactes a supprimer'),
      dryRun: z.boolean().optional().describe('true = simulation sans ecrire (defaut false)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, safe(({ refs, dryRun }) => {
    const res = deleteItems(refs, !!dryRun)
    return ok({ dryRun: res.dryRun, counts: { deleted: res.deleted.length, notFound: res.notFound.length }, deleted: res.deleted, notFound: res.notFound })
  }))
}

server.registerResource('nexus-database-info', 'nexus://info', {
  title: 'Infos base NEXUS',
  description: 'Dossier de donnees et metadonnees de la base',
  mimeType: 'application/json',
}, async (uri) => {
  const { db, file } = loadDb()
  return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ file, meta: db.meta, itemCount: db.items.length }, null, 2) }] }
})

async function main() {
  await server.connect(new StdioServerTransport())
  log(`v${pkg.version} pret — donnees : ${paths.dir} — ecriture : ${ALLOW_WRITE ? 'activee' : 'desactivee'}`)
}

process.on('exit', () => { try { releaseLock() } catch { /* ignore */ } })

main().catch((error) => {
  log('erreur fatale', error)
  process.exit(1)
})
