/**
 * Chute de tension (formule du guide UTE C 15-105) et limites NF C 15-100.
 * u = b (rho L / S cos phi + lambda L sin phi) IB ; b = 1 en tri, 2 en mono ; dU % = 100 u / U0.
 */
const { fr } = require('../enveloppe.cjs')
const { ErreurCalcul } = require('./iz.cjs')

const U0 = 230

function rho(d, materiau, trace) {
  const t = d.resistivites.tableaux.find((x) => x.lignes.some((l) => l.usage === 'chute_tension'))
  const l = t.lignes.find((x) => x.usage === 'chute_tension')
  const value = l[materiau]
  if (!value) throw new ErreurCalcul(`Resistivite inconnue pour ${materiau}.`)
  trace.utilise({ ...d.resistivites, ...t }, t, `resistivite ${materiau} chute de tension`)
  return value
}

function sectionCalcul(d, section) {
  // convention du guide : 50 mm² pris a 47,5 mm²
  return section === 50 && d.resistivites.note_section_50 ? 47.5 : section
}

/** Chute de tension en V/A sur un metre, selon le systeme. */
function unitaire(d, p, trace) {
  const r = rho(d, p.materiau, trace)
  const lambda = (p.lambda_mohm_m ?? d.resistivites.reactance_lineique_mohm_m) / 1000
  const cos = p.cos_phi ?? 0.8
  if (!(cos > 0 && cos <= 1)) throw new ErreurCalcul('cos_phi doit etre entre 0 et 1.')
  const sin = Math.sqrt(1 - cos * cos)
  const s = sectionCalcul(d, p.section_mm2)
  const b = p.systeme === 'mono' ? 2 : 1
  const parMetre = b * ((r / s) * cos + lambda * sin) // V/A/m sur U0
  return { r, lambda, cos, sin, s, b, parMetre }
}

function limite(d, p, trace) {
  const reg = d.chute_tension_regles
  const l = reg.limites.find((x) => x.type_alimentation === (p.type_alimentation || 'A') && x.usage === (p.usage || 'autres'))
  if (!l) throw new ErreurCalcul('type_alimentation doit valoir A ou B, usage eclairage ou autres.')
  trace.utilise(reg, reg, `limite de chute de tension ${l.type_alimentation} ${l.usage}`)
  return l
}

/** Valeur du tableau V/A/km pour controle croise (null si absente). */
function valeurTableau(d, p) {
  if (p.materiau !== 'Cu') return null
  const cos = p.cos_phi ?? 0.8
  const l = d.chute_tension_tableaux.unitaire.lignes.find((x) => x.systeme === (p.systeme === 'mono' ? 'mono' : 'tri') && x.section_mm2 === p.section_mm2 && x.cos_phi === cos)
  return l || null
}

function chuteTension(d, p, trace) {
  for (const k of ['section_mm2', 'longueur_m', 'courant_a']) if (!(p[k] > 0)) throw new ErreurCalcul(`${k} doit etre positif.`)
  if (!['Cu', 'Al'].includes(p.materiau)) throw new ErreurCalcul('materiau doit valoir Cu ou Al.')
  if (!['mono', 'tri'].includes(p.systeme)) throw new ErreurCalcul('systeme doit valoir mono ou tri.')
  const u = unitaire(d, p, trace)
  // u : chute sur un conducteur de phase (tri) ou aller-retour (mono), rapportee a U0 = 230 V.
  const uPhase = u.parMetre * p.longueur_m * p.courant_a
  const pct = (100 * uPhase) / U0
  // En tri, la chute exprimee en volts l'est entre phases (u x racine 3, sur 400 V), comme les tableaux V/A/km.
  const chuteV = p.systeme === 'tri' ? uPhase * Math.sqrt(3) : uPhase
  trace.etape(`u = ${u.b} x (${fr(u.r, 4)} x ${fr(p.longueur_m)} / ${fr(u.s)} x ${fr(u.cos)} + ${fr(u.lambda * 1000, 3)}e-3 x ${fr(p.longueur_m)} x ${fr(u.sin)}) x ${fr(p.courant_a)} = ${fr(uPhase, 2)} V`)
  if (p.systeme === 'tri') trace.etape(`Chute entre phases = ${fr(uPhase, 2)} x racine 3 = ${fr(chuteV, 2)} V ; dU = 100 x ${fr(chuteV, 2)} / 400 = ${fr(pct, 2)} %`)
  else trace.etape(`dU = 100 x ${fr(chuteV, 2)} / ${U0} = ${fr(pct, 2)} %`)

  const amont = p.chute_amont_pct ?? 0
  const cumul = pct + amont
  if (amont) trace.etape(`Chute cumulee = ${fr(amont, 2)} % (amont) + ${fr(pct, 2)} % = ${fr(cumul, 2)} %`)
  const lim = limite(d, p, trace)
  trace.etape(`Limite (alimentation ${lim.type_alimentation}, ${lim.usage}) = ${fr(lim.limite_pct)} %`)

  const tab = valeurTableau(d, p)
  let controle = null
  if (tab) {
    const vTab = tab.v_par_a_km * (p.longueur_m / 1000) * p.courant_a
    const ecart = (chuteV - vTab) / vTab
    trace.utilise(d.chute_tension_tableaux.unitaire, tab, `V/A/km ${tab.systeme} ${fr(tab.section_mm2)} mm² cos ${fr(tab.cos_phi)}`)
    controle = { tableau_v_par_a_km: tab.v_par_a_km, chute_tableau_v: Math.round(vTab * 100) / 100, ecart_pct: Math.round(ecart * 1000) / 10 }
    trace.etape(`Controle par le tableau V/A/km : ${fr(tab.v_par_a_km)} x ${fr(p.longueur_m / 1000, 3)} km x ${fr(p.courant_a)} A = ${fr(vTab, 2)} V (ecart ${fr(ecart * 100, 1)} %)`)
    if (Math.abs(ecart) > 0.05) trace.avertir(`Ecart de ${fr(ecart * 100, 1)} % entre la formule et le tableau V/A/km : verifier la valeur du tableau.`)
  }

  let demarrage = null
  if (p.demarrage_moteur) {
    const { id_sur_in: idIn, isource_sur_id: isId } = p.demarrage_moteur
    const k2t = d.chute_tension_tableaux.demarrage_k2
    // Cote defavorable : K2 croit avec Id/In et decroit avec Isource/Id.
    // On retient donc Id/In tabule immediatement superieur ou egal, Isource/Id immediatement inferieur ou egal.
    const idVals = [...new Set(k2t.lignes.map((l) => l.id_sur_in))].sort((x, y) => x - y)
    const isVals = [...new Set(k2t.lignes.map((l) => l.isource_sur_id))].sort((x, y) => x - y)
    const idRetenu = idVals.find((v) => v >= idIn)
    const isRetenu = [...isVals].reverse().find((v) => v <= isId)
    if (idRetenu === undefined || isRetenu === undefined) {
      throw new ErreurCalcul(`Demarrage moteur hors du tableau K2 (Id/In de ${idVals[0]} a ${idVals.at(-1)}, Isource/Id de ${isVals[0]} a ${isVals.at(-1)}).`)
    }
    const choix = k2t.lignes.find((l) => l.isource_sur_id === isRetenu && l.id_sur_in === idRetenu)
    trace.utilise(k2t, choix, `K2 demarrage ${choix.isource_sur_id}/${choix.id_sur_in}`)
    const pctDem = pct * choix.k2 + amont * choix.k2
    trace.etape(`Demarrage : K2 (Isource/Id ${fr(choix.isource_sur_id)}, Id/In ${fr(choix.id_sur_in)}) = ${fr(choix.k2)} ; dU demarrage = ${fr(cumul, 2)} x ${fr(choix.k2)} = ${fr(pctDem, 2)} %`)
    if (choix.isource_sur_id !== isId || choix.id_sur_in !== idIn) trace.avertir('K2 : valeurs de demarrage entre deux lignes du tableau, ligne la plus penalisante retenue.')
    const limDem = d.chute_tension_regles.limite_demarrage_moteur_pct
    demarrage = { k2: choix.k2, chute_demarrage_pct: Math.round(pctDem * 100) / 100, limite_pct: limDem, conforme: pctDem <= limDem }
  }

  return {
    chute_v: Math.round(chuteV * 100) / 100,
    chute_pct: Math.round(pct * 100) / 100,
    chute_cumulee_pct: Math.round(cumul * 100) / 100,
    limite_pct: lim.limite_pct,
    conforme: cumul <= lim.limite_pct,
    marge_pct: Math.round((lim.limite_pct - cumul) * 100) / 100,
    methode: 'Formule UTE C 15-105',
    controle_tableau: controle,
    demarrage,
  }
}

function longueurMax(d, p, trace) {
  for (const k of ['section_mm2', 'courant_a']) if (!(p[k] > 0)) throw new ErreurCalcul(`${k} doit etre positif.`)
  if (!['mono', 'tri'].includes(p.systeme)) throw new ErreurCalcul('systeme doit valoir mono ou tri.')
  const u = unitaire(d, p, trace)
  const lim = p.chute_admissible_pct ?? (limite(d, p, trace).limite_pct - (p.chute_amont_pct ?? 0))
  if (!(lim > 0)) throw new ErreurCalcul('Plus aucune chute de tension disponible apres la chute amont.')
  const l = (lim / 100) * U0 / (u.parMetre * p.courant_a)
  trace.etape(`L max = ${fr(lim, 2)} % x ${U0} V / (${fr(u.parMetre * 1000, 4)} V/A/km / 1000 x ${fr(p.courant_a)} A) = ${fr(l, 0)} m`)
  return { longueur_max_m: Math.floor(l), chute_disponible_pct: Math.round(lim * 100) / 100 }
}

module.exports = { chuteTension, longueurMax }
