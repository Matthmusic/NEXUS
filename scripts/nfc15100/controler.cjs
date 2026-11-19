#!/usr/bin/env node
/**
 * Controles automatiques d'un jeu de donnees nfc15100.
 * Usage : node scripts/nfc15100/controler.cjs <dossier-jeu> [rapport.md]
 *
 * Ces controles attrapent les fautes de saisie grossieres (chiffre mal lu,
 * colonne decalee). Ils ne prouvent pas qu'une valeur est juste : seule la
 * verification contre la norme le fait.
 */
const fs = require('fs')
const path = require('path')

const [, , dir, reportPath] = process.argv
if (!dir) {
  console.error('Usage : node controler.cjs <dossier-jeu> [rapport.md]')
  process.exit(1)
}
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'))
const anomalies = [] // { gravite, tableau, message }
const add = (gravite, tableau, message) => anomalies.push({ gravite, tableau, message })
const stats = []

// ---------------------------------------------------------------------------
// Iz
// ---------------------------------------------------------------------------
const iz = read('iz_admissible.json')
const colKey = (l) => `${l.materiau} ${l.isolant}${l.nb_conducteurs_charges}${l.disposition ? ` ${l.disposition}` : ''}`
const colonnes = {} // methode -> colKey -> [lignes triees par section]

for (const t of iz.tableaux) {
  const cols = {}
  for (const l of t.lignes) (cols[colKey(l)] ||= []).push(l)
  for (const [k, ls] of Object.entries(cols)) {
    ls.sort((a, b) => a.section_mm2 - b.section_mm2)
    // monotonie
    for (let i = 1; i < ls.length; i += 1) {
      if (ls[i].iz_a <= ls[i - 1].iz_a) add('erreur', t.tableau, `${t.methode} ${k} : Iz non croissant ${ls[i - 1].section_mm2} -> ${ls[i].section_mm2} mm² (${ls[i - 1].iz_a} -> ${ls[i].iz_a} A)`)
    }
  }
  colonnes[t.methode] = cols
  stats.push(`${t.tableau} ${t.methode} : ${t.lignes.length} valeurs`)
}

// comparaisons entre colonnes a section egale
function compare(methode, a, b, libelle) {
  const ca = colonnes[methode]?.[a]; const cb = colonnes[methode]?.[b]
  if (!ca || !cb) return
  for (const la of ca) {
    const lb = cb.find((x) => x.section_mm2 === la.section_mm2)
    if (lb && lb.iz_a <= la.iz_a) add('erreur', methode, `${libelle} non respecte a ${la.section_mm2} mm² : ${a} = ${la.iz_a} A, ${b} = ${lb.iz_a} A`)
  }
}
for (const m of Object.keys(colonnes)) {
  for (const mat of ['Cu', 'Al']) {
    for (const n of [2, 3]) compare(m, `${mat} PVC${n}`, `${mat} PR${n}`, 'PR > PVC')
    for (const is of ['PVC', 'PR']) compare(m, `${mat} ${is}3`, `${mat} ${is}2`, '2 conducteurs charges > 3')
  }
  for (const is of ['PVC2', 'PVC3', 'PR2', 'PR3']) compare(m, `Al ${is}`, `Cu ${is}`, 'Cu > Al')
}

// regularite : rapport Iz(S_i+1)/Iz(S_i) compare a la mediane des colonnes du meme materiau
const ratios = {} // `${materiau}|${s1}-${s2}` -> [{ ratio, ou }]
for (const [m, cols] of Object.entries(colonnes)) {
  for (const [k, ls] of Object.entries(cols)) {
    for (let i = 1; i < ls.length; i += 1) {
      const key = `${ls[i].materiau}|${ls[i - 1].section_mm2}-${ls[i].section_mm2}`
      ;(ratios[key] ||= []).push({ ratio: ls[i].iz_a / ls[i - 1].iz_a, ou: `${m} ${k}`, l0: ls[i - 1], l1: ls[i] })
    }
  }
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2 }
const SEUIL_REGULARITE = 0.04
for (const [key, list] of Object.entries(ratios)) {
  if (list.length < 4) continue
  const med = median(list.map((x) => x.ratio))
  for (const x of list) {
    const ecart = Math.abs(x.ratio - med) / med
    if (ecart > SEUIL_REGULARITE) {
      add('a_regarder', x.ou.split(' ')[0], `${x.ou} : saut ${key.split('|')[1]} mm² = x${x.ratio.toFixed(3)} (mediane des colonnes x${med.toFixed(3)}, ecart ${(ecart * 100).toFixed(1)} %) — valeurs ${x.l0.iz_a} -> ${x.l1.iz_a} A`)
    }
  }
}

// ---------------------------------------------------------------------------
// Facteurs de correction
// ---------------------------------------------------------------------------
const fc = read('facteurs_correction.json')
for (const t of fc.tableaux) {
  stats.push(`${t.tableau} : ${t.lignes.length} coefficients`)
  const groupes = {}
  for (const l of t.lignes) (groupes[`${l.isolant || l.disposition}|${l.nb_tablettes ?? ''}`] ||= []).push(l)
  for (const [g, ls] of Object.entries(groupes)) {
    ls.sort((a, b) => a.valeur - b.valeur)
    for (let i = 1; i < ls.length; i += 1) {
      if (ls[i].coefficient > ls[i - 1].coefficient) add('erreur', t.tableau, `${g} : coefficient croissant ${ls[i - 1].valeur} -> ${ls[i].valeur} (${ls[i - 1].coefficient} -> ${ls[i].coefficient})`)
    }
    for (const l of ls) if (l.coefficient <= 0 || l.coefficient > 2.5) add('erreur', t.tableau, `${g} : coefficient hors plage ${l.coefficient}`)
  }
  // plusieurs tablettes : coefficient <= celui d'une seule tablette
  if (t.lignes.some((l) => l.nb_tablettes)) {
    for (const l of t.lignes) {
      const ref = t.lignes.find((x) => x.disposition === l.disposition && x.valeur === l.valeur && x.nb_tablettes === 1)
      if (ref && l.nb_tablettes > 1 && l.coefficient > ref.coefficient) add('erreur', t.tableau, `${l.disposition} ${l.valeur} : ${l.nb_tablettes} tablettes (${l.coefficient}) > 1 tablette (${ref.coefficient})`)
    }
  }
  // reference = 1 a la condition de reference
  if (t.grandeur === 'temperature_air') for (const l of t.lignes) if (l.valeur === 30 && l.coefficient !== 1) add('erreur', t.tableau, `coefficient a 30 °C different de 1 (${l.isolant})`)
  if (t.grandeur === 'temperature_sol') for (const l of t.lignes) if (l.valeur === 20 && l.coefficient !== 1) add('erreur', t.tableau, `coefficient a 20 °C different de 1 (${l.isolant})`)
  if (t.grandeur === 'resistivite_sol') for (const l of t.lignes) if (l.valeur === 2.5 && l.coefficient !== 1) add('erreur', t.tableau, `coefficient a 2,5 K.m/W different de 1 (${l.disposition})`)
}

// ---------------------------------------------------------------------------
// Chute de tension : tableau V/A/km contre la formule
// ---------------------------------------------------------------------------
const ct = read('chute_tension_tableaux.json')
const res = read('resistivites.json')
const rhoCu = res.tableaux.find((t) => t.tableau.startsWith('UTE')).lignes.find((l) => l.usage === 'chute_tension').Cu
const lambda = res.reactance_lineique_mohm_m / 1000 // ohm/m
const ecarts = []
for (const l of ct.unitaire.lignes) {
  if (l.v_par_a_km === null) { add('erreur', 'V/A/km', `valeur manquante ${l.systeme} ${l.section_mm2} mm² cos ${l.cos_phi}`); continue }
  const s = l.section_mm2 === 50 ? 47.5 : l.section_mm2
  const sin = Math.sqrt(1 - l.cos_phi ** 2)
  const parPhase = (rhoCu * 1000 / s) * l.cos_phi + lambda * 1000 * sin // V/A/km sur un conducteur
  const calc = l.systeme === 'tri' ? Math.sqrt(3) * parPhase : 2 * parPhase
  const ecart = (l.v_par_a_km - calc) / calc
  ecarts.push({ ...l, calc, ecart })
}
const parGroupe = {}
for (const e of ecarts) (parGroupe[`${e.systeme} cos ${e.cos_phi}`] ||= []).push(e)
const resumeCt = []
for (const [g, es] of Object.entries(parGroupe)) {
  const med = median(es.map((e) => e.ecart))
  resumeCt.push(`${g} : ecart median tableau/formule ${(med * 100).toFixed(1)} %`)
  for (const e of es) {
    if (Math.abs(e.ecart - med) > 0.08) add('a_regarder', 'V/A/km', `${g}, ${e.section_mm2} mm² : tableau ${e.v_par_a_km}, formule ${e.calc.toFixed(3)} (ecart ${(e.ecart * 100).toFixed(1)} %, mediane ${(med * 100).toFixed(1)} %)`)
  }
}
// tri vs mono : rapport attendu 2/sqrt(3) = 1,155
for (const e of ecarts.filter((x) => x.systeme === 'tri')) {
  const m = ecarts.find((x) => x.systeme === 'mono' && x.section_mm2 === e.section_mm2 && x.cos_phi === e.cos_phi)
  if (m) {
    const r = m.v_par_a_km / e.v_par_a_km
    if (Math.abs(r - 2 / Math.sqrt(3)) > 0.08) add('a_regarder', 'V/A/km', `${e.section_mm2} mm² cos ${e.cos_phi} : mono/tri = ${r.toFixed(3)} (attendu 1,155)`)
  }
}

// ---------------------------------------------------------------------------
// Transformateurs : In = S / (U sqrt 3), Ik3 ~ In / Ucc, Z ~ sqrt(R² + X²)
// ---------------------------------------------------------------------------
const tr = read('transformateurs.json')
for (const l of tr.lignes) {
  const In = (l.puissance_kva * 1000) / (l.u_v * Math.sqrt(3))
  if (Math.abs(In - l.in_a) / In > 0.02) add('erreur', 'transformateurs', `${l.puissance_kva} kVA : In ${l.in_a} A, calcule ${In.toFixed(0)} A`)
  const ik = l.in_a / (l.ucc_pct / 100)
  if (Math.abs(ik - l.ik3_a) / ik > 0.03) add('a_regarder', 'transformateurs', `${l.puissance_kva} kVA : Ik3 ${l.ik3_a} A, In/Ucc = ${ik.toFixed(0)} A`)
  const z = Math.hypot(l.r_mohm, l.x_mohm)
  if (Math.abs(z - l.z_mohm) / z > 0.03) add('a_regarder', 'transformateurs', `${l.puissance_kva} kVA : Z ${l.z_mohm} mΩ, racine(R²+X²) = ${z.toFixed(2)} mΩ`)
  const zth = ((l.u_v ** 2) * l.ucc_pct / 100) / (l.puissance_kva * 1000) * 1000
  if (Math.abs(zth - l.z_mohm) / zth > 0.03) add('a_regarder', 'transformateurs', `${l.puissance_kva} kVA : Z ${l.z_mohm} mΩ, U²·Ucc/S = ${zth.toFixed(2)} mΩ`)
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------
const erreurs = anomalies.filter((a) => a.gravite === 'erreur')
const aRegarder = anomalies.filter((a) => a.gravite === 'a_regarder')
const lines = [
  `# Rapport de controle — jeu ${path.basename(dir)}`,
  '',
  `Genere le ${new Date().toISOString().slice(0, 10)} par scripts/nfc15100/controler.cjs.`,
  '',
  `**${erreurs.length} erreur(s)** (incoherence certaine) et **${aRegarder.length} point(s) a regarder** (valeur inhabituelle, a confronter a la norme).`,
  '',
  '## Contenu controle',
  ...stats.map((s) => `- ${s}`),
  '',
  '## Chute de tension : tableau contre formule',
  `Formule C 15-105 avec rho = ${rhoCu} ohm.mm²/m (Cu) et lambda = ${res.reactance_lineique_mohm_m} mOhm/m.`,
  ...resumeCt.map((s) => `- ${s}`),
  '',
  '## Erreurs',
  ...(erreurs.length ? erreurs.map((a) => `- [${a.tableau}] ${a.message}`) : ['Aucune.']),
  '',
  '## Points a regarder',
  ...(aRegarder.length ? aRegarder.map((a) => `- [${a.tableau}] ${a.message}`) : ['Aucun.']),
  '',
]
const text = lines.join('\n')
if (reportPath) fs.writeFileSync(reportPath, text)
console.log(text)
process.exitCode = erreurs.length ? 2 : 0
