#!/usr/bin/env node
/**
 * Extrait les tableaux chiffres de la fiche de synthese NF C 15-100 (Markdown)
 * vers les fichiers JSON d'un jeu de donnees du module nfc15100.
 *
 * Usage : node scripts/nfc15100/extraire-fiche.cjs <fiche.md> <dossier-jeu>
 *
 * Toutes les valeurs sortent en verif "non_verifie" et licence "a_valider".
 * Le dossier de sortie ne doit PAS etre dans ce depot (depot public) :
 * les valeurs viennent de la norme et restent sur le reseau interne.
 */
const fs = require('fs')
const path = require('path')
const { num, tableAfter, pageOf } = require('./lib-markdown.cjs')

const [, , fichePath, outDir] = process.argv
if (!fichePath || !outDir) {
  console.error('Usage : node extraire-fiche.cjs <fiche.md> <dossier-jeu>')
  process.exit(1)
}
const md = fs.readFileSync(fichePath, 'utf-8')
const SOURCE = 'schneider-g3-2025'
const BASE = { source: SOURCE, licence: 'a_valider' }
const NV = 'non_verifie'

// ---------------------------------------------------------------------------
// Iz : tableaux 52.8A a 52.8H.2
// ---------------------------------------------------------------------------
const TABLEAU_IZ = {
  A1: ['52.8A', 'p. 408'], A2: ['52.8B', 'p. 409'], B1: ['52.8C', 'p. 410'], B2: ['52.8D', 'p. 411'],
  C: ['52.8E', 'p. 412'], E: ['52.8F', 'p. 412'], F: ['52.8F', 'p. 412'],
  D1: ['52.8H.1', 'p. 413'], D2: ['52.8H.2', 'p. 414'],
}

function parseIzHeader(h) {
  // "A1 PVC3", "F PVC3 trèfle", "F PR2"
  const m = h.match(/^(A1|A2|B1|B2|C|D1|D2|E|F)\s+(PVC|PR)([23])(?:\s+(trèfle|nappe))?$/)
  if (!m) return null
  const disposition = m[4] === 'trèfle' ? 'trefle' : m[4] === 'nappe' ? 'nappe' : null
  return { methode: m[1], isolant: m[2], nb_conducteurs_charges: Number(m[3]), disposition }
}

function extraireIz() {
  const blocs = {}
  for (const titre of ['### A1 (52.8A', '### C (52.8E', '### D1 enterré']) {
    const t = tableAfter(md, titre)
    const cols = t.headers.map(parseIzHeader)
    for (const row of t.rows) {
      const m = row[0].match(/^(Cu|Alu)\s+([\d,]+)$/)
      if (!m) continue
      const materiau = m[1] === 'Cu' ? 'Cu' : 'Al'
      const section = num(m[2])
      cols.forEach((col, j) => {
        if (!col) return
        const iz = num(row[j])
        if (iz === null) return
        const [tableau, page] = TABLEAU_IZ[col.methode]
        const key = `${tableau}|${col.methode}`
        blocs[key] ||= { tableau, methode: col.methode, page_source: page, ...BASE, lignes: [] }
        const ligne = { materiau, isolant: col.isolant, nb_conducteurs_charges: col.nb_conducteurs_charges }
        if (col.disposition) ligne.disposition = col.disposition
        blocs[key].lignes.push({ ...ligne, section_mm2: section, iz_a: iz, verif: NV })
      })
    }
  }
  return {
    description: 'Courants admissibles Iz (A), conditions de reference : 30 °C air, 20 °C et 2,5 K.m/W sol.',
    tableaux: Object.values(blocs),
  }
}

// ---------------------------------------------------------------------------
// Facteurs de correction 52.9 a 52.18
// ---------------------------------------------------------------------------
const AIR = ['A1', 'A2', 'B1', 'B2', 'C', 'E', 'F', 'G']

function tableauTemperature(titre, tableau, grandeur, methodes) {
  const t = tableAfter(md, titre)
  const temps = t.headers.slice(1).map(num)
  const lignes = []
  for (const row of t.rows) {
    const isolant = row[0].startsWith('PVC') ? 'PVC' : 'PR'
    temps.forEach((temp, j) => {
      const c = num(row[j + 1])
      if (c !== null) lignes.push({ isolant, valeur: temp, coefficient: c, verif: NV })
    })
  }
  return { tableau, grandeur, sens_defavorable: 'superieur', methodes, page_source: pageOf(t.heading), ...BASE, lignes }
}

function tableauSimple(titre, tableau, grandeur, methodes, dispositionDeLigne, extra = {}) {
  const t = tableAfter(md, titre)
  const valeurs = t.headers.slice(1).map(num)
  const lignes = []
  for (const row of t.rows) {
    const disposition = dispositionDeLigne(row[0])
    if (!disposition) continue
    valeurs.forEach((v, j) => {
      const c = num(row[j + 1])
      if (v !== null && c !== null) lignes.push({ disposition, valeur: v, coefficient: c, verif: NV })
    })
  }
  return { tableau, grandeur, sens_defavorable: 'superieur', methodes, page_source: pageOf(t.heading), ...BASE, ...extra, lignes }
}

function extraire5212() {
  const t = tableAfter(md, 'Tableau 52.12')
  const ns = t.headers.slice(1).map(num)
  const POINTS = {
    '1.': { disposition: 'groupes_air_surface_noyes', methodes: ['A1', 'A2', 'B1', 'B2'] },
    '2.': { disposition: 'simple_couche_paroi_plancher', methodes: ['C'], poses: [20, 30] },
    '3.': { disposition: 'simple_couche_sous_plafond', methodes: ['C'], poses: [21] },
    '5.': { disposition: 'cable_porteur', methodes: ['E', 'F'], poses: [35] },
  }
  const lignes = []
  for (const row of t.rows) {
    const p = POINTS[row[0].slice(0, 2)]
    if (!p) continue
    ns.forEach((n, j) => {
      const c = num(row[j + 1])
      if (c !== null) lignes.push({ disposition: p.disposition, valeur: n, coefficient: c, verif: NV })
    })
  }
  return {
    tableau: '52.12', grandeur: 'nb_circuits', sens_defavorable: 'superieur',
    methodes: ['A1', 'A2', 'B1', 'B2', 'C', 'E', 'F'],
    dispositions: Object.values(POINTS),
    regle_au_dela: { simple_couche_paroi_plancher: 'constant', simple_couche_sous_plafond: 'constant' },
    note: 'Ecartement > 2 x diametre exterieur : pas de reduction. n cables mono = n/2 ou n/3 circuits. Multiplier par 52.15 si plusieurs couches.',
    page_source: pageOf(t.heading), ...BASE, lignes,
  }
}

function extraire5213() {
  const t = tableAfter(md, 'Tableau 52.13')
  const ns = t.headers.slice(2).map(num)
  const lignes = []
  let courante = null
  const nom = (txt) => {
    const s = txt.toLowerCase()
    const jointif = s.includes('non jointifs') ? 'espaces' : 'jointifs'
    if (s.startsWith('tablettes perforées')) return `tablette_perforee_horizontale_${jointif}`
    if (s.startsWith('tablettes verticales')) return `tablette_verticale_${jointif}`
    if (s.startsWith('échelles')) return `echelle_corbeaux_${jointif}`
    return null
  }
  for (const row of t.rows) {
    if (row[0]) courante = nom(row[0])
    const nbTab = num(row[1])
    if (!courante || nbTab === null) continue
    ns.forEach((n, j) => {
      const c = num(row[j + 2])
      if (c !== null) lignes.push({ disposition: courante, nb_tablettes: nbTab, valeur: n, coefficient: c, verif: NV })
    })
  }
  return { tableau: '52.13', grandeur: 'nb_cables', sens_defavorable: 'superieur', methodes: ['E'], page_source: pageOf(t.heading), ...BASE, lignes }
}

function extraire5214() {
  const t = tableAfter(md, 'Tableau 52.14')
  const lignes = []
  for (const row of t.rows) {
    const s = row[0].toLowerCase()
    const forme = row[5].toLowerCase().includes('trèfle') ? 'trefle' : 'nappe'
    let support
    if (s.startsWith('tablettes perforées')) support = 'tablette_perforee_horizontale'
    else if (s.startsWith('tablettes verticales')) support = 'tablette_verticale'
    else if (s.startsWith('échelles')) support = 'echelle_corbeaux'
    else continue
    const disposition = `${support}_${forme}`
    const tabs = row[1].split('/').map(num)
    for (let k = 1; k <= 3; k += 1) {
      const vals = row[k + 1] === '–' ? [] : row[k + 1].split('/').map(num)
      vals.forEach((c, i) => {
        if (c !== null && tabs[i] !== undefined) lignes.push({ disposition, nb_tablettes: tabs[i], valeur: k, coefficient: c, verif: NV })
      })
    }
  }
  return { tableau: '52.14', grandeur: 'nb_circuits', sens_defavorable: 'superieur', methodes: ['F'], page_source: pageOf(t.heading), ...BASE, lignes }
}

function extraire5215() {
  const t = tableAfter(md, 'Tableau 52.15')
  const lignes = []
  t.headers.slice(1).forEach((h, j) => {
    const c = num(t.rows[0][j + 1])
    const nums = (h.match(/\d+/g) || []).map(Number)
    const de = nums[0]
    const a = h.includes('ou') || h.includes('à') ? nums[1] : de
    for (let n = de; n <= a; n += 1) lignes.push({ disposition: 'toutes', valeur: n, coefficient: c, verif: NV })
  })
  return {
    tableau: '52.15', grandeur: 'nb_couches', sens_defavorable: 'superieur',
    methodes: ['A1', 'A2', 'B1', 'B2', 'C', 'E', 'F'], regle_au_dela: { toutes: 'constant' },
    page_source: pageOf(t.heading), ...BASE, lignes,
  }
}

function extraireFacteurs() {
  const espacement = (txt) => {
    const s = txt.toLowerCase()
    if (s.startsWith('jointifs') || s.startsWith('conduits jointifs')) return 'jointifs'
    if (s.startsWith('1 diamètre')) return 'un_diametre'
    const m = s.match(/([\d,]+)\s*m/)
    return m ? `espaces_${num(m[1])}m` : null
  }
  const t5211 = tableauSimple('Tableau 52.11', '52.11', 'resistivite_sol', ['D1', 'D2'],
    (l) => (l.toLowerCase().includes('directement') ? 'direct_sol' : l.toLowerCase().includes('conduit') ? 'en_conduit' : null))
  t5211.sens_defavorable = 'superieur'
  return {
    description: 'Facteurs de correction (52.9 a 52.18). sens_defavorable : quand la valeur demandee tombe entre deux lignes, on retient la ligne superieure.',
    tableaux: [
      tableauTemperature('Tableau 52.9', '52.9', 'temperature_air', AIR),
      tableauTemperature('Tableau 52.10', '52.10', 'temperature_sol', ['D1', 'D2']),
      t5211,
      extraire5212(),
      extraire5213(),
      extraire5214(),
      extraire5215(),
      tableauSimple('Tableau 52.16', '52.16', 'nb_circuits', ['D2'], espacement),
      tableauSimple('Tableau 52.17 A', '52.17A', 'nb_cables', ['D1'], espacement,
        { note: 'Un cable multiconducteur par conduit. Le 52.17 B (monoconducteurs) est incomplet dans la fiche : non importe.' }),
      tableauSimple('Tableau 52.18', '52.18', 'nb_circuits', ['D1'], () => 'meme_conduit'),
    ],
  }
}

// ---------------------------------------------------------------------------
// Modes de pose (p. 407)
// ---------------------------------------------------------------------------
function expandPoses(txt) {
  const out = []
  for (const part of txt.split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?/)
    if (!m) continue
    const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a
    for (let n = a; n <= b; n += 1) out.push(n)
  }
  return out
}

function extraireMethodes() {
  const t = tableAfter(md, 'Correspondance modes de pose')
  const methodes = []
  for (const row of t.rows) {
    const [meth, tableau, poseTxt] = row
    const m = poseTxt.match(/^([\d,\s-]+)\s*\((.*)\)\s*$/)
    const poses = expandPoses(m ? m[1] : poseTxt)
    const description = m ? m[2].replace(/\*\*/g, '') : ''
    const noms = meth.includes('/') ? [['E', 'multiconducteur'], ['F', 'monoconducteurs']] : [[meth, null]]
    for (const [code, typeCable] of noms) {
      methodes.push({
        methode: code,
        tableau_iz: tableau,
        type_cable: typeCable || (code === 'B1' || code === 'A1' ? 'monoconducteurs_ou_conducteurs' : code === 'B2' || code === 'A2' ? 'multiconducteur' : 'tous'),
        milieu: code.startsWith('D') ? 'sol' : 'air',
        temperature_reference_c: code.startsWith('D') ? 20 : 30,
        modes_pose: poses,
        description,
        verif: NV,
      })
    }
  }
  return {
    tableau: 'Modes de pose / méthodes de référence',
    description: 'Correspondance mode de pose -> methode de reference -> tableau Iz.',
    page_source: 'p. 407', ...BASE,
    poses_sans_tolerance_5pct: [31, 32, 34, 35, 72, 73],
    note: 'Certains modes (40-47, 54) figurent en B1 (conducteurs/monoconducteurs) et en B2 (multiconducteurs) : le type de cable tranche.',
    methodes,
  }
}

// ---------------------------------------------------------------------------
// Chute de tension (tableaux V/A/km, K2) et transformateurs
// ---------------------------------------------------------------------------
function extraireChuteTension() {
  const tri = tableAfter(md, 'Chute de tension en V par A et par km')
  const cosCols = [0.8, 0.35, 0.45, 1]
  const lignesTri = []
  const alEquiv = []
  for (const row of tri.rows) {
    const s = num(row[0])
    if (s !== null && num(row[1]) !== null) alEquiv.push({ cu_mm2: s, al_mm2: num(row[1]) })
    if (s === null) continue
    cosCols.forEach((cos, j) => lignesTri.push({ systeme: 'tri', materiau: 'Cu', section_mm2: s, cos_phi: cos, v_par_a_km: num(row[j + 2]), verif: NV }))
  }
  // monophase : ligne de texte "1,5 → 24 / 10,6 / 13,6 / 30 ; ..."
  const monoLine = md.split(/\r?\n/).find((l) => l.startsWith('**Monophasé (p. 423)**'))
  const lignesMono = []
  for (const part of monoLine.split(':').slice(1).join(':').split(';')) {
    const m = part.trim().match(/^([\d,]+)\s*→\s*(.+)$/)
    if (!m) continue
    const vals = m[2].split('/').map((v) => num(v.replace('.', '')))
    cosCols.forEach((cos, j) => lignesMono.push({ systeme: 'mono', materiau: 'Cu', section_mm2: num(m[1]), cos_phi: cos, v_par_a_km: vals[j], verif: NV }))
  }
  const k2 = tableAfter(md, 'coefficient K2')
  const idIn = k2.headers.slice(1).map(num)
  const lignesK2 = []
  for (const row of k2.rows) {
    idIn.forEach((r, j) => lignesK2.push({ isource_sur_id: num(row[0]), id_sur_in: r, k2: num(row[j + 1]), verif: NV }))
  }
  return {
    unitaire: { tableau: 'V/A/km', page_source: 'p. 423-424', ...BASE, equivalence_alu: alEquiv, lignes: [...lignesTri, ...lignesMono] },
    demarrage_k2: { tableau: 'K2 demarrage', page_source: 'p. 426', ...BASE, lignes: lignesK2 },
  }
}

function extraireTransformateurs() {
  const t = tableAfter(md, 'Transformateurs HTA/BT')
  return {
    description: 'Transformateurs HTA/BT, 410 V a vide.',
    tableau: 'transformateurs', page_source: pageOf(t.heading), ...BASE,
    lignes: t.rows.map((r) => ({
      puissance_kva: num(r[0]), ucc_pct: num(r[1]), r_mohm: num(r[2]), x_mohm: num(r[3]), z_mohm: num(r[4]),
      in_a: num(r[5]), ik3_a: num(r[6]), u_v: 410, verif: NV,
    })),
  }
}

function extraireCondensateurs() {
  const line = md.split(/\r?\n/).find((l) => l.startsWith('Câbles unipolaires') || l.includes('Batterie à 400 V (kvar)'))
  const lignes = []
  for (const part of line.split(':').slice(1).join(':').split(';')) {
    const m = part.trim().match(/^(\d+)\s*→\s*([^/]+)\/(.+?)\.?$/)
    if (m) lignes.push({ puissance_kvar: Number(m[1]), cu: m[2].trim(), al: m[3].trim(), verif: NV })
  }
  return { tableau: 'condensateurs 400 V', page_source: 'p. 363', ...BASE, lignes }
}

// ---------------------------------------------------------------------------
fs.mkdirSync(outDir, { recursive: true })
const write = (name, data) => {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(data, null, 1)}\n`)
  console.log('ecrit', name)
}
const ct = extraireChuteTension()
write('iz_admissible.json', extraireIz())
write('facteurs_correction.json', extraireFacteurs())
write('methodes_pose.json', extraireMethodes())
write('chute_tension_tableaux.json', ct)
write('transformateurs.json', extraireTransformateurs())
write('condensateurs.json', extraireCondensateurs())
