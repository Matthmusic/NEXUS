/**
 * Courants admissibles et section minimale (NF C 15-100, partie 5-52).
 *
 * Toutes les valeurs viennent du jeu de donnees charge (aucune valeur normative ici).
 * Regle generale : quand une grandeur tombe entre deux lignes d'un tableau, on retient
 * la ligne la plus penalisante (sens_defavorable du tableau), et on le note.
 */
const { fr } = require('../enveloppe.cjs')

class ErreurCalcul extends Error {}

const LIBELLE_SYSTEME = { mono: 'monophase (2 conducteurs charges)', tri: 'triphase (3 conducteurs charges)', tri_neutre_charge: 'triphase, neutre charge (4 conducteurs charges)' }

// ---------------------------------------------------------------------------
// Mode de pose -> methode de reference
// ---------------------------------------------------------------------------

const MONO = new Set(['monoconducteurs', 'monoconducteurs_ou_conducteurs'])

function typeCompatible(methode, typeCable) {
  if (!typeCable || methode.type_cable === 'tous') return true
  if (typeCable === 'monoconducteurs') return MONO.has(methode.type_cable)
  return methode.type_cable === 'multiconducteur'
}

/** Renvoie l'entree de methodes_pose.json correspondant aux parametres. */
function resoudreMethode(d, { mode_pose, methode, type_cable }, trace) {
  const mp = d.methodes_pose
  let candidats
  if (mode_pose !== undefined && mode_pose !== null) {
    candidats = mp.methodes.filter((m) => m.modes_pose.includes(Number(mode_pose)))
    if (!candidats.length) throw new ErreurCalcul(`Mode de pose ${mode_pose} inconnu. Utiliser nexus_nfc_mode_pose pour le trouver.`)
    const filtres = candidats.filter((m) => typeCompatible(m, type_cable))
    if (filtres.length) candidats = filtres
    if (candidats.length > 1) {
      throw new ErreurCalcul(`Le mode de pose ${mode_pose} correspond a plusieurs methodes (${candidats.map((m) => m.methode).join(', ')}) : preciser type_cable (multiconducteur ou monoconducteurs).`)
    }
  } else if (methode) {
    candidats = mp.methodes.filter((m) => m.methode === methode)
    if (!candidats.length) throw new ErreurCalcul(`Methode ${methode} inconnue.`)
  } else {
    throw new ErreurCalcul('Indiquer mode_pose (numero) ou methode (A1, A2, B1, B2, C, D1, D2, E, F).')
  }
  const m = candidats[0]
  trace.utilise(mp, m, `correspondance pose -> methode ${m.methode}`)
  trace.etape(`Methode de reference ${m.methode}${mode_pose ? ` (mode de pose ${mode_pose})` : ''}, tableau ${m.tableau_iz}`)
  return m
}

// ---------------------------------------------------------------------------
// Lecture d'un tableau de facteurs
// ---------------------------------------------------------------------------

function tableauFacteurs(d, code) {
  const t = d.facteurs_correction.tableaux.find((x) => x.tableau === code)
  if (!t) throw new ErreurCalcul(`Tableau ${code} absent du jeu de donnees.`)
  return t
}

/**
 * Cherche le coefficient d'un tableau de facteurs.
 * filtre : { isolant?, disposition?, nb_tablettes? } ; valeur : grandeur demandee.
 */
function coefficient(d, code, filtre, valeur, trace, libelle) {
  const t = tableauFacteurs(d, code)
  const lignes = t.lignes.filter((l) => Object.entries(filtre).every(([k, v]) => v === undefined || l[k] === v))
  if (!lignes.length) {
    const dispo = [...new Set(t.lignes.map((l) => l.disposition).filter(Boolean))]
    throw new ErreurCalcul(`Tableau ${code} : aucune ligne pour ${JSON.stringify(filtre)}.${dispo.length ? ` Dispositions possibles : ${dispo.join(', ')}.` : ''}`)
  }
  lignes.sort((a, b) => a.valeur - b.valeur)
  let ligne = lignes.find((l) => l.valeur === valeur)
  let note = ''
  if (!ligne) {
    const comptage = ['nb_circuits', 'nb_cables', 'nb_couches'].includes(t.grandeur)
    if (comptage && valeur <= 1 && lignes[0].valeur > 1) {
      trace.etape(`${libelle} (${code}) : un seul circuit, pas de reduction = 1`)
      return 1
    }
    const superieure = lignes.find((l) => l.valeur > valeur)
    if (superieure && valeur > lignes[0].valeur) {
      ligne = superieure
      note = ` (valeur ${fr(valeur)} entre deux lignes : ligne ${fr(superieure.valeur)} retenue, cote defavorable)`
    } else if (valeur < lignes[0].valeur) {
      ligne = lignes[0]
      note = ` (valeur ${fr(valeur)} sous le tableau : premiere ligne ${fr(ligne.valeur)} retenue)`
    } else {
      const regle = t.regle_au_dela && t.regle_au_dela[filtre.disposition || 'toutes']
      if (regle === 'constant') {
        ligne = lignes[lignes.length - 1]
        note = ` (au-dela du tableau : pas de reduction supplementaire, ligne ${fr(ligne.valeur)})`
      } else {
        const max = fr(lignes[lignes.length - 1].valeur)
        if (t.grandeur.startsWith('temperature')) throw new ErreurCalcul(`${fr(valeur)} °C depasse la temperature maximale du tableau ${code}${filtre.isolant ? ` pour l'isolant ${filtre.isolant}` : ''} (${max} °C) : isolant inadapte.`)
        throw new ErreurCalcul(`Tableau ${code} : ${fr(valeur)} depasse la derniere ligne (${max}). Hors du domaine du tableau.`)
      }
    }
  }
  trace.utilise(t, ligne, `${code} ${filtre.isolant || filtre.disposition || ''} ${fr(ligne.valeur)}`.trim())
  trace.etape(`${libelle} (${code}${filtre.disposition ? `, ${filtre.disposition}` : ''}${filtre.nb_tablettes ? `, ${filtre.nb_tablettes} tablette(s)` : ''}) = ${fr(ligne.coefficient)}${note}`)
  return ligne.coefficient
}

// ---------------------------------------------------------------------------
// Facteurs de correction d'une pose
// ---------------------------------------------------------------------------

function particulier(d, id) {
  return d.facteurs_particuliers.facteurs.find((f) => f.id === id)
}

/**
 * Calcule le facteur global K et son detail.
 * p : { methode (objet), isolant, temperature_c, resistivite_sol, groupement, mode_pose,
 *       type_cable, systeme, thd_i3_pct, cables_paralleles_par_phase, disposition_paralleles_conforme, local_be3 }
 */
function facteurs(d, p, trace) {
  const m = p.methode
  const sol = m.milieu === 'sol'
  const detail = {}
  const fp = d.facteurs_particuliers

  // Temperature
  const tRef = m.temperature_reference_c
  const temp = p.temperature_c ?? tRef
  if (p.temperature_c === undefined || p.temperature_c === null) trace.etape(`Temperature ${sol ? 'du sol' : 'ambiante'} non precisee : ${tRef} °C (reference)`)
  detail.temperature = temp === tRef ? 1 : coefficient(d, sol ? '52.10' : '52.9', { isolant: p.isolant }, temp, trace, sol ? 'K temperature du sol' : 'K temperature ambiante')
  if (temp === tRef) trace.etape(`K temperature = 1 (${tRef} °C, condition de reference)`)

  // Resistivite thermique du sol
  if (sol) {
    const rho = p.resistivite_sol ?? 2.5
    if (p.resistivite_sol === undefined || p.resistivite_sol === null) trace.avertir('Resistivite thermique du sol non precisee : 2,5 K.m/W retenu (reference, cote prudent). En France un terrain sec est d\'environ 1 K.m/W, ce qui donnerait une section plus faible.')
    detail.resistivite_sol = rho === 2.5 ? 1 : coefficient(d, '52.11', { disposition: m.methode === 'D1' ? 'en_conduit' : 'direct_sol' }, rho, trace, 'K resistivite du sol')
  }

  // Groupement
  const g = p.groupement || {}
  const n = g.nb_circuits ?? 1
  detail.groupement = groupement(d, m, p, g, n, trace)

  // Plusieurs couches (52.15) : methodes A1 a C
  if (g.nb_couches && g.nb_couches > 1) {
    if (['A1', 'A2', 'B1', 'B2', 'C'].includes(m.methode)) {
      detail.couches = coefficient(d, '52.15', { disposition: 'toutes' }, g.nb_couches, trace, 'K plusieurs couches')
    } else {
      trace.avertir(`nb_couches ignore pour la methode ${m.methode} : utiliser nb_tablettes (52.13 / 52.14) ou un tableau de groupement adapte.`)
    }
  }

  // Symetrie (cables en parallele)
  const par = p.cables_paralleles_par_phase ?? 1
  const sym = particulier(d, 'symetrie')
  if (par > (sym?.max_cables_paralleles_par_phase ?? 4)) {
    throw new ErreurCalcul(`${par} cables en parallele par phase : ${sym?.au_dela || 'au-dela de la limite, canalisation prefabriquee'}`)
  }
  if (par > 1) {
    // Regles du jeu de donnees : par nombre de cables, type de cable et conformite de la disposition
    const conforme = p.disposition_paralleles_conforme
    const regle = sym.regles.find((r) => r.si?.type_cable && r.si.type_cable === p.type_cable) || sym.regles.find((r) => {
      const si = r.si || {}
      if (si.type_cable) return si.type_cable === p.type_cable
      if (si.cables_paralleles_par_phase && !si.cables_paralleles_par_phase.includes(par)) return false
      if (si.disposition_conforme !== undefined) return si.disposition_conforme === (conforme !== false)
      return Boolean(si.cables_paralleles_par_phase)
    })
    if (!regle) throw new ErreurCalcul(`Facteur de symetrie : aucune regle pour ${par} cables par phase.`)
    const fs = regle.coefficient
    if (conforme === undefined && regle.si?.disposition_conforme === true) {
      trace.avertir('Cables en parallele : disposition conforme supposee. Si la disposition des monoconducteurs n\'est pas conforme, le facteur de symetrie est plus faible.')
    }
    trace.utilise({ ...fp, ...sym, tableau: 'facteur de symetrie' }, sym, 'facteur de symetrie')
    trace.etape(`fs symetrie (${par} cables par phase${p.type_cable === 'multiconducteur' ? ', multiconducteurs' : ''}) = ${fr(fs)}`)
    detail.symetrie = fs
    trace.avertir('Cables en parallele : chaque cable compte comme un circuit dans le groupement si ce n\'est pas deja pris en compte dans nb_circuits.')
  }

  // Neutre charge
  const kn = particulier(d, 'neutre_charge')
  const thd = p.thd_i3_pct
  if (p.systeme === 'tri_neutre_charge' || (p.systeme === 'tri' && thd !== undefined && thd !== null && thd > kn.seuil_thd_i3_pct)) {
    trace.utilise({ ...fp, ...kn, tableau: 'facteur neutre charge' }, kn, 'Kn neutre charge')
    trace.etape(`Kn neutre charge (THD I3 ${thd !== undefined && thd !== null ? `${fr(thd)} %` : 'inconnu'}) = ${fr(kn.coefficient)}`)
    detail.neutre_charge = kn.coefficient
  }

  // BE3
  if (p.local_be3) {
    const be3 = particulier(d, 'be3')
    trace.utilise({ ...fp, ...be3, tableau: 'local BE3' }, be3, 'facteur BE3')
    trace.etape(`K local BE3 = ${fr(be3.coefficient)}`)
    detail.be3 = be3.coefficient
  }

  const k = Object.values(detail).reduce((a, b) => a * b, 1)
  trace.etape(`K global = ${Object.entries(detail).map(([, v]) => fr(v)).join(' x ')} = ${fr(k, 4)}`)
  return { k, detail }
}

function groupement(d, m, p, g, n, trace) {
  const pose = p.mode_pose !== undefined && p.mode_pose !== null ? Number(p.mode_pose) : null
  const disp = g.disposition
  const defaut = (valeur, message) => {
    if (!disp) trace.avertir(message)
    return disp || valeur
  }
  switch (m.methode) {
    case 'A1': case 'A2': case 'B1': case 'B2':
      return coefficient(d, '52.12', { disposition: 'groupes_air_surface_noyes' }, n, trace, 'K groupement')
    case 'C': {
      const dispo = pose === 21 ? 'simple_couche_sous_plafond' : (disp || 'simple_couche_paroi_plancher')
      return coefficient(d, '52.12', { disposition: dispo }, n, trace, 'K groupement')
    }
    case 'E': case 'F': {
      if (pose === 35) return coefficient(d, '52.12', { disposition: 'cable_porteur' }, n, trace, 'K groupement')
      const tablettes = g.nb_tablettes ?? 1
      if (m.methode === 'E') {
        const dispo = defaut(pose === 32 || pose === 34 ? 'echelle_corbeaux_jointifs' : 'tablette_perforee_horizontale_jointifs',
          'Disposition sur chemin de cables non precisee : cables jointifs retenus (cote defavorable).')
        return coefficient(d, '52.13', { disposition: dispo, nb_tablettes: tablettes }, n, trace, 'K groupement')
      }
      // meme disposition par defaut que colonneIz : trefle en 3 conducteurs charges (Iz le plus faible)
      const forme = p.disposition || (nbConducteurs(p.systeme) === 3 ? 'trefle' : 'nappe')
      const dispo = disp || `${pose === 32 || pose === 34 ? 'echelle_corbeaux' : 'tablette_perforee_horizontale'}_${forme}`
      return coefficient(d, '52.14', { disposition: dispo, nb_tablettes: tablettes }, n, trace, 'K groupement')
    }
    case 'D1': {
      if (disp === 'meme_conduit') return coefficient(d, '52.18', { disposition: 'meme_conduit' }, n, trace, 'K groupement')
      const dispo = defaut('jointifs', 'Ecartement des conduits enterres non precise : conduits jointifs retenus (cote defavorable).')
      return coefficient(d, '52.17A', { disposition: dispo }, n, trace, 'K groupement')
    }
    case 'D2': {
      const dispo = defaut('jointifs', 'Ecartement des cables enterres non precise : cables jointifs retenus (cote defavorable).')
      return coefficient(d, '52.16', { disposition: dispo }, n, trace, 'K groupement')
    }
    default:
      throw new ErreurCalcul(`Methode ${m.methode} : pas de tableau de groupement dans le jeu de donnees.`)
  }
}

// ---------------------------------------------------------------------------
// Tableau Iz
// ---------------------------------------------------------------------------

function nbConducteurs(systeme) {
  if (systeme === 'mono') return 2
  if (systeme === 'tri' || systeme === 'tri_neutre_charge') return 3
  throw new ErreurCalcul('systeme doit valoir mono, tri ou tri_neutre_charge.')
}

/** Colonne Iz (lignes triees par section) pour une methode et des conditions. */
function colonneIz(d, m, p, trace) {
  const n = nbConducteurs(p.systeme)
  const blocs = d.iz_admissible.tableaux.filter((t) => t.methode === m.methode)
  if (!blocs.length) throw new ErreurCalcul(`Pas de tableau Iz pour la methode ${m.methode} dans le jeu de donnees.`)
  let disposition
  if (m.methode === 'F' && n === 3) {
    disposition = p.disposition || 'trefle'
    if (!p.disposition) trace.avertir('Methode F, 3 conducteurs charges : disposition non precisee, trefle retenu (Iz le plus faible).')
  }
  const bloc = blocs[0]
  const lignes = bloc.lignes
    .filter((l) => l.materiau === p.materiau && l.isolant === p.isolant && l.nb_conducteurs_charges === n && (disposition ? l.disposition === disposition : !l.disposition))
    .sort((a, b) => a.section_mm2 - b.section_mm2)
  if (!lignes.length) throw new ErreurCalcul(`Tableau ${bloc.tableau} : aucune valeur pour ${p.materiau} ${p.isolant}, ${n} conducteurs charges${disposition ? `, ${disposition}` : ''}.`)
  return { bloc, lignes, n, disposition }
}

// ---------------------------------------------------------------------------
// Courant a retenir selon la protection
// ---------------------------------------------------------------------------

function courantProtection(d, ib, protection, trace) {
  const cp = d.courant_protection
  const type = protection?.type || 'disjoncteur'
  let calibre = protection?.calibre_a
  if (calibre === undefined || calibre === null) {
    calibre = cp.calibres_normalises_a.find((c) => c >= ib)
    if (!calibre) throw new ErreurCalcul(`IB = ${ib} A depasse le plus grand calibre de la liste (${cp.calibres_normalises_a.at(-1)} A) : indiquer le calibre.`)
    trace.etape(`Calibre non precise : ${calibre} A (calibre usuel immediatement superieur a IB = ${fr(ib)} A)`)
  } else if (calibre < ib) {
    throw new ErreurCalcul(`Calibre ${calibre} A inferieur a IB = ${ib} A : la condition IB <= In n'est pas respectee.`)
  }
  let coef = 1
  if (type === 'fusible') {
    if (calibre < 16) coef = cp.fusible.si_in_inferieur_a_16
    else if (calibre > 16) coef = cp.fusible.si_in_superieur_a_16
    else {
      coef = Math.max(cp.fusible.si_in_inferieur_a_16, cp.fusible.si_in_superieur_a_16)
      trace.avertir(`Fusible 16 A : ${cp.fusible.in_egal_16}.`)
    }
  } else if (type !== 'disjoncteur') {
    throw new ErreurCalcul('protection.type doit valoir disjoncteur ou fusible.')
  }
  trace.utilise(cp, cp, `courant de protection ${type}`)
  const i = calibre * coef
  trace.etape(`Courant a retenir : ${type} ${calibre} A${coef !== 1 ? ` x ${fr(coef)}` : ''} = ${fr(i)} A`)
  return { type, calibre_a: calibre, coefficient: coef, courant_a: i }
}

// ---------------------------------------------------------------------------
// Neutre
// ---------------------------------------------------------------------------

function regleNeutre(d, p, trace) {
  const sn = d.section_neutre
  trace.utilise(sn, sn, 'regles de section du neutre')
  const thd = p.thd_i3_pct
  const connu = thd !== undefined && thd !== null
  let refus = null
  // Regles evaluees dans l'ordre du jeu de donnees : la premiere dont toutes les conditions sont remplies s'applique.
  for (const r of sn.regles) {
    const ok = []
    const manque = []
    for (const [cle, val] of Object.entries(r.si)) {
      if (cle === 'thd_i3_pct_sup') (connu && thd > val ? ok.push(`THD I3 = ${fr(thd)} % > ${fr(val)} %`) : manque.push(connu ? `THD I3 <= ${fr(val)} %` : 'THD I3 inconnu'))
      else if (cle === 'thd_i3_pct_max') (connu && thd <= val ? ok.push(`THD I3 <= ${fr(val)} %`) : manque.push(connu ? `THD I3 > ${fr(val)} %` : 'THD I3 inconnu'))
      else if (cle === 'systeme') (p.systeme === val ? ok.push(`systeme ${val}`) : manque.push(`systeme ${p.systeme}`))
      else if (cle === 'section_max') (p.section_mm2 <= val[p.materiau] ? ok.push(`section ${fr(p.section_mm2)} mm² <= ${val[p.materiau]} mm² ${p.materiau}`) : manque.push('section'))
      else if (cle === 'section_sup') (p.section_mm2 > val[p.materiau] ? ok.push(`section ${fr(p.section_mm2)} mm² > ${val[p.materiau]} mm² ${p.materiau}`) : manque.push('section trop faible'))
      else if (cle === 'charges_equilibrees' || cle === 'neutre_protege') (p[cle] === val ? ok.push(cle.replace('_', ' ')) : manque.push(`${cle.replace('_', ' ')} non confirme`))
      else manque.push(`condition inconnue ${cle}`)
    }
    if (!manque.length) return { ...r, raison: ok.join(', ') }
    if (r.resultat === 'neutre_reduit_possible' && r.si.section_sup && p.section_mm2 > r.si.section_sup[p.materiau]) refus = manque
  }
  return { resultat: 'neutre_egal_phase', raison: refus ? `reduction non admise : ${refus.join(', ')}` : 'aucune condition de reduction remplie' }
}

// ---------------------------------------------------------------------------
// Section minimale
// ---------------------------------------------------------------------------

function verifierEntrees(p) {
  if (!['Cu', 'Al'].includes(p.materiau)) throw new ErreurCalcul('materiau doit valoir Cu ou Al.')
  if (!['PVC', 'PR'].includes(p.isolant)) throw new ErreurCalcul('isolant doit valoir PVC ou PR (PR = PR/EPR, 90 °C).')
}

function preparer(d, p, trace) {
  verifierEntrees(p)
  const methode = resoudreMethode(d, p, trace)
  const parDefaut = { E: 'multiconducteur', B2: 'multiconducteur', A2: 'multiconducteur', F: 'monoconducteurs', B1: 'monoconducteurs', A1: 'monoconducteurs' }
  const typeCable = p.type_cable || parDefaut[methode.methode]
  const ctx = { ...p, methode, type_cable: typeCable }
  trace.etape(`${LIBELLE_SYSTEME[p.systeme] || p.systeme}, ${p.materiau}, isolant ${p.isolant}`)
  return ctx
}

function sectionMinimale(d, p, trace) {
  if (!(p.courant_emploi_a > 0)) throw new ErreurCalcul('courant_emploi_a (IB) doit etre positif.')
  const ctx = preparer(d, p, trace)
  const prot = courantProtection(d, p.courant_emploi_a, p.protection, trace)
  const { k, detail } = facteurs(d, ctx, trace)
  const col = colonneIz(d, ctx.methode, ctx, trace)
  const par = p.cables_paralleles_par_phase ?? 1
  const izRequis = prot.courant_a / par / k
  trace.etape(`Iz requis par cable = ${fr(prot.courant_a)} A${par > 1 ? ` / ${par} cables` : ''} / ${fr(k, 4)} = ${fr(izRequis, 1)} A`)

  const tol = particulier(d, 'tolerance_iz')
  let tolerance = 1
  if (p.tolerance_5pct) {
    const pose = Number(p.mode_pose)
    if (tol.poses_exclues.includes(pose)) {
      trace.avertir(`Tolerance de 5 % refusee : non admise pour le mode de pose ${pose}.`)
    } else {
      tolerance = 1 + tol.tolerance_pct / 100
      trace.utilise({ ...d.facteurs_particuliers, ...tol, tableau: 'tolerance Iz' }, tol, 'tolerance 5 %')
      trace.etape(`Tolerance de ${tol.tolerance_pct} % appliquee sur Iz`)
    }
  }

  // Condition : Iz tableau (x tolerance eventuelle) >= Iz requis = I / K, soit Iz corrige = Iz tableau x K >= I.
  const idx = col.lignes.findIndex((l) => l.iz_a * tolerance >= izRequis)
  if (idx < 0) {
    const max = col.lignes.at(-1)
    throw new ErreurCalcul(`Aucune section du tableau ${col.bloc.tableau} ne suffit : la plus grande (${fr(max.section_mm2)} mm², Iz tableau ${fr(max.iz_a)} A) reste sous l'Iz requis de ${fr(izRequis, 1)} A. Envisager des cables en parallele (cables_paralleles_par_phase) ou une canalisation prefabriquee.`)
  }
  const retenue = col.lignes[idx]
  trace.utilise(col.bloc, retenue, `${col.bloc.tableau} ${p.materiau} ${p.isolant}${col.n} ${fr(retenue.section_mm2)} mm² = ${fr(retenue.iz_a)} A`)
  trace.etape(`Section retenue ${fr(retenue.section_mm2)} mm² : Iz tableau ${fr(retenue.iz_a)} A >= Iz requis ${fr(izRequis, 1)} A (Iz corrige ${fr(retenue.iz_a * k, 1)} A >= ${fr(prot.courant_a / par, 1)} A par cable)`)

  const voisines = {}
  if (idx > 0) {
    const inf = col.lignes[idx - 1]
    trace.utilise(col.bloc, inf, `${col.bloc.tableau} ${fr(inf.section_mm2)} mm² = ${fr(inf.iz_a)} A`)
    voisines.inferieure = { section_mm2: inf.section_mm2, iz_corrige_a: round(inf.iz_a * k), insuffisante_de_a: round(prot.courant_a / par - inf.iz_a * k * tolerance) }
  }
  if (idx < col.lignes.length - 1) {
    const sup = col.lignes[idx + 1]
    voisines.superieure = { section_mm2: sup.section_mm2, iz_corrige_a: round(sup.iz_a * k) }
  }

  // Neutre
  let neutre = null
  {
    const r = regleNeutre(d, {
      systeme: p.systeme, materiau: p.materiau, section_mm2: retenue.section_mm2, thd_i3_pct: p.thd_i3_pct,
      charges_equilibrees: p.charges_equilibrees, neutre_protege: p.neutre_protege,
    }, trace)
    neutre = { regle: r.resultat, raison: r.raison }
    if (r.resultat === 'neutre_egal_phase') neutre.section_mm2 = retenue.section_mm2
    if (r.resultat === 'neutre_superieur_phase') trace.avertir(`Neutre : ${r.note || 'section superieure a la phase, calcul specifique'}`)
    if (r.resultat === 'neutre_reduit_possible') neutre.note = 'Reduction admise sous conditions : la section du neutre reste a dimensionner (protection du neutre obligatoire).'
    trace.etape(`Neutre : ${r.resultat.replace(/_/g, ' ')} (${r.raison})`)
  }

  if (p.thd_i3_pct === undefined && p.systeme !== 'mono') {
    trace.avertir('THD I3 non precise : si le taux d\'harmoniques est inconnu, la detection de surcharge du neutre est exigee en polyphase et Kn peut s\'appliquer (systeme = tri_neutre_charge).')
  }

  return {
    section_phase_mm2: retenue.section_mm2,
    cables_paralleles_par_phase: par,
    neutre,
    methode: ctx.methode.methode,
    tableau_iz: col.bloc.tableau,
    iz_tableau_a: retenue.iz_a,
    k_total: round(k, 4),
    facteurs: detail,
    iz_corrige_a: round(retenue.iz_a * k),
    protection: prot,
    iz_requis_a: round(izRequis),
    sections_voisines: voisines,
    pour_chiffrage: pourChiffrage(ctx, retenue.section_mm2, neutre, par),
    verifications_restantes: [
      'Chute de tension (nexus_nfc_chute_tension)',
      'Courant de court-circuit : Lmax en TN/IT, ou DDR en TT',
      'Contraintes thermiques en court-circuit',
      'Section du PE',
    ],
  }
}

function round(v, digits = 1) {
  return Math.round(v * 10 ** digits) / 10 ** digits
}

/** Parametres prets pour nexus_cable_price. */
function pourChiffrage(p, section, neutre, par) {
  const s = String(section).replace('.', ',')
  const type = p.type_nexus || null
  if (p.type_cable === 'monoconducteurs') {
    const neutreSection = neutre?.section_mm2 ?? section
    const termes = [`${par}x${p.systeme === 'mono' ? 1 : 3}x1x${s}`]
    if (p.systeme !== 'tri' || neutre?.section_mm2) termes.push(`${par}x1x${String(neutreSection).replace('.', ',')} N`)
    return {
      type,
      composition: termes.join(' + '),
      note: 'Composition sans le PE (a dimensionner a part). Retirer le neutre s\'il n\'est pas distribue.',
    }
  }
  const coeurs = p.systeme === 'mono' ? 3 : 5
  return {
    type,
    section: `${coeurs}G${s}`,
    count: par > 1 ? par : undefined,
    note: p.systeme === 'mono' ? 'Phase + neutre + PE.' : '3 phases + neutre + PE ; 4G si le neutre n\'est pas distribue. PE de meme section que la phase suppose.',
  }
}

function courantAdmissible(d, p, trace) {
  if (!(p.section_mm2 > 0)) throw new ErreurCalcul('section_mm2 doit etre positive.')
  const ctx = preparer(d, p, trace)
  const { k, detail } = facteurs(d, ctx, trace)
  const col = colonneIz(d, ctx.methode, ctx, trace)
  const ligne = col.lignes.find((l) => l.section_mm2 === p.section_mm2)
  if (!ligne) throw new ErreurCalcul(`Section ${p.section_mm2} mm² absente du tableau ${col.bloc.tableau} pour ces conditions. Sections : ${col.lignes.map((l) => l.section_mm2).join(', ')}.`)
  trace.utilise(col.bloc, ligne, `${col.bloc.tableau} ${fr(ligne.section_mm2)} mm² = ${fr(ligne.iz_a)} A`)
  const par = p.cables_paralleles_par_phase ?? 1
  const iz = ligne.iz_a * k
  trace.etape(`Iz = ${fr(ligne.iz_a)} A x ${fr(k, 4)} = ${fr(iz, 1)} A par cable${par > 1 ? `, soit ${fr(iz * par, 1)} A pour ${par} cables` : ''}`)
  return {
    methode: ctx.methode.methode,
    tableau_iz: col.bloc.tableau,
    section_mm2: p.section_mm2,
    iz_tableau_a: ligne.iz_a,
    k_total: round(k, 4),
    facteurs: detail,
    iz_corrige_a: round(iz),
    iz_total_a: round(iz * par),
    calibre_disjoncteur_max_a: d.courant_protection.calibres_normalises_a.filter((c) => c <= iz * par).at(-1) ?? null,
  }
}

function facteursSeuls(d, p, trace) {
  const ctx = preparer(d, { ...p, materiau: p.materiau || 'Cu' }, trace)
  const { k, detail } = facteurs(d, ctx, trace)
  return { methode: ctx.methode.methode, k_total: round(k, 4), facteurs: detail }
}

module.exports = {
  ErreurCalcul, resoudreMethode, coefficient, facteurs, colonneIz, courantProtection,
  regleNeutre, sectionMinimale, courantAdmissible, facteursSeuls,
}
