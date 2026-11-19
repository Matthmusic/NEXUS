/**
 * Module NF C 15-100 du serveur MCP NEXUS : outils nexus_nfc_* (lecture seule).
 *
 * Les donnees normatives ne sont pas dans ce depot : elles sont lues dans
 * <dataDir>/nfc15100 (ou NEXUS_NFC_DIR). Voir docs/nfc15100.md.
 */
const path = require('path')
const FuseModule = require('fuse.js')
const { z } = require('zod')
const { createStore } = require('./donnees.cjs')
const { Trace } = require('./enveloppe.cjs')
const iz = require('./calculs/iz.cjs')
const ct = require('./calculs/chute-tension.cjs')

const Fuse = FuseModule.default || FuseModule

const INSTRUCTIONS = 'Module NF C 15-100 (outils nexus_nfc_*) : dimensionnement des canalisations BT (section selon le courant, '
  + 'le mode de pose, le groupement et la temperature ; chute de tension ; neutre). Les calculs sont faits par les outils : '
  + 'ne pas lire les tableaux pour calculer soi-meme. Toujours citer les references renvoyees, et signaler en une phrase '
  + 'les avertissements, en particulier les valeurs non verifiees. Pour chiffrer la section trouvee, passer pour_chiffrage a nexus_cable_price.'

const normalize = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ---------------------------------------------------------------------------
// Schemas communs
// ---------------------------------------------------------------------------
const jeu = z.string().optional().describe('Version du jeu de donnees (defaut : jeu publie actif). Pour refaire un ancien calcul.')

const pose = {
  materiau: z.enum(['Cu', 'Al']).describe('Cu ou Al'),
  isolant: z.enum(['PVC', 'PR']).describe('PVC (70 °C) ou PR (PR/EPR, 90 °C). U1000 R2V = PR.'),
  systeme: z.enum(['mono', 'tri', 'tri_neutre_charge']).describe('mono = 2 conducteurs charges ; tri = 3 ; tri_neutre_charge = neutre charge (harmoniques), applique Kn'),
  mode_pose: z.number().int().optional().describe('Numero du mode de pose (prioritaire). Voir nexus_nfc_mode_pose.'),
  methode: z.enum(['A1', 'A2', 'B1', 'B2', 'C', 'D1', 'D2', 'E', 'F']).optional().describe('Methode de reference, si le mode de pose n\'est pas connu'),
  type_cable: z.enum(['multiconducteur', 'monoconducteurs']).optional().describe('Necessaire quand un mode de pose existe pour les deux types (40-47, 54, chemins de cables)'),
  disposition: z.enum(['trefle', 'nappe']).optional().describe('Methode F, monoconducteurs : trefle ou nappe (defaut trefle, cote defavorable)'),
  temperature_c: z.number().optional().describe('Temperature ambiante (air) ou du sol (D1/D2). Defaut 30 °C air, 20 °C sol'),
  resistivite_sol: z.number().positive().optional().describe('K.m/W, D1/D2 seulement. Defaut 2,5 (France, terrain sec : environ 1)'),
  groupement: z.object({
    nb_circuits: z.number().int().min(1).optional().describe('Nombre de circuits (ou de cables pour 52.13/52.17A) groupes, y compris celui-ci'),
    disposition: z.string().optional().describe('Disposition du tableau de groupement (ex. jointifs, espaces_0.25m, meme_conduit, tablette_perforee_horizontale_espaces). Defaut : la plus defavorable'),
    nb_couches: z.number().int().min(1).optional().describe('Nombre de couches (52.15, methodes A1 a C)'),
    nb_tablettes: z.number().int().min(1).optional().describe('Nombre de tablettes ou d\'echelles superposees (E/F)'),
  }).optional(),
  cables_paralleles_par_phase: z.number().int().min(1).optional().describe('Cables en parallele par phase (defaut 1, au-dela de 4 : canalisation prefabriquee)'),
  disposition_paralleles_conforme: z.boolean().optional().describe('Disposition des monoconducteurs en parallele conforme (fs = 1) ou non (fs = 0,8)'),
  thd_i3_pct: z.number().min(0).optional().describe('Taux d\'harmoniques de rang 3 (%), pour le neutre et Kn'),
  local_be3: z.boolean().optional().describe('Local a risque d\'explosion BE3 (facteur supplementaire)'),
  jeu_donnees: jeu,
}

// ---------------------------------------------------------------------------

function registerNfcTools(server, { getDataDir, log = () => {} }) {
  const store = createStore(() => process.env.NEXUS_NFC_DIR || path.join(getDataDir(), 'nfc15100'))

  const text = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] })
  const fail = (message) => ({ content: [{ type: 'text', text: message }], isError: true })

  /** Charge le jeu, execute le calcul avec une trace, gere les erreurs. */
  const run = (fn) => async (args = {}) => {
    try {
      const d = store.charger(args.jeu_donnees)
      const trace = new Trace(d)
      const resultat = fn(d, args, trace)
      return text(trace.reponse(resultat))
    } catch (error) {
      if (!(error instanceof iz.ErreurCalcul)) log('nfc15100', error)
      return fail(error.message || String(error))
    }
  }

  const ro = { readOnlyHint: true }

  server.registerTool('nexus_nfc_section_minimale', {
    title: 'NF C 15-100 : section minimale d\'un cable',
    description: 'Calcule la plus petite section qui respecte IB <= In <= Iz, avec tous les facteurs de correction (temperature, sol, groupement, '
      + 'couches, symetrie, neutre charge, BE3). Renvoie le detail du calcul, les references, la section du neutre et les parametres '
      + '"pour_chiffrage" a passer a nexus_cable_price. Ne verifie pas la chute de tension ni les courts-circuits.',
    inputSchema: {
      courant_emploi_a: z.number().positive().describe('Courant d\'emploi IB (A)'),
      protection: z.object({
        type: z.enum(['disjoncteur', 'fusible']).describe('Type de protection (defaut disjoncteur)'),
        calibre_a: z.number().positive().optional().describe('Calibre In ou reglage Ir (A). Defaut : calibre usuel immediatement superieur a IB'),
      }).optional(),
      ...pose,
      tolerance_5pct: z.boolean().optional().describe('Appliquer la tolerance de 5 % sur Iz (defaut non ; refusee pour 31, 32, 34, 35, 72, 73)'),
      charges_equilibrees: z.boolean().optional().describe('Pour la reduction du neutre'),
      neutre_protege: z.boolean().optional().describe('Pour la reduction du neutre'),
      type_nexus: z.string().optional().describe('Type de cable NEXUS (ex. "U1000 R2V") pour preparer l\'appel a nexus_cable_price'),
    },
    annotations: ro,
  }, run((d, a, t) => iz.sectionMinimale(d, a, t)))

  server.registerTool('nexus_nfc_courant_admissible', {
    title: 'NF C 15-100 : courant admissible d\'une section',
    description: 'Courant admissible Iz d\'une section donnee dans des conditions de pose donnees (Iz tableau x K), et plus grand calibre de disjoncteur usuel admissible.',
    inputSchema: { section_mm2: z.number().positive().describe('Section (mm²)'), ...pose },
    annotations: ro,
  }, run((d, a, t) => iz.courantAdmissible(d, a, t)))

  server.registerTool('nexus_nfc_facteurs_correction', {
    title: 'NF C 15-100 : facteurs de correction',
    description: 'Facteur global K et son detail pour des conditions de pose (temperature, sol, groupement, couches, symetrie, neutre charge, BE3).',
    inputSchema: { ...pose, materiau: pose.materiau.optional() },
    annotations: ro,
  }, run((d, a, t) => iz.facteursSeuls(d, a, t)))

  const chute = {
    systeme: z.enum(['mono', 'tri']).describe('mono (230 V) ou tri (400 V)'),
    materiau: z.enum(['Cu', 'Al']),
    section_mm2: z.number().positive(),
    courant_a: z.number().positive().describe('Courant d\'emploi IB (A)'),
    cos_phi: z.number().optional().describe('Defaut 0,8 (eclairage : 1)'),
    lambda_mohm_m: z.number().optional().describe('Reactance lineique, defaut 0,08 mOhm/m'),
    type_alimentation: z.enum(['A', 'B']).optional().describe('A : reseau BT public ; B : poste HTA/BT prive. Defaut A'),
    usage: z.enum(['eclairage', 'autres']).optional().describe('Defaut autres'),
    chute_amont_pct: z.number().min(0).optional().describe('Chute de tension deja consommee en amont (%)'),
    jeu_donnees: jeu,
  }

  server.registerTool('nexus_nfc_chute_tension', {
    title: 'NF C 15-100 : chute de tension',
    description: 'Chute de tension d\'une canalisation (formule du guide UTE C 15-105), cumul avec l\'amont, comparaison a la limite NF C 15-100, '
      + 'controle croise avec le tableau V/A/km et, si demande, chute au demarrage d\'un moteur (coefficient K2).',
    inputSchema: {
      ...chute,
      longueur_m: z.number().positive().describe('Longueur de la canalisation (m)'),
      demarrage_moteur: z.object({
        id_sur_in: z.number().positive().describe('Id/In du moteur (2-3 etoile-triangle, 4-8 direct)'),
        isource_sur_id: z.number().positive().describe('Rapport courant de court-circuit de la source / courant de demarrage'),
      }).optional(),
    },
    annotations: ro,
  }, run((d, a, t) => ct.chuteTension(d, a, t)))

  server.registerTool('nexus_nfc_longueur_max', {
    title: 'NF C 15-100 : longueur maximale (chute de tension)',
    description: 'Longueur maximale d\'une canalisation pour rester dans la chute de tension admissible (limite moins chute amont, ou valeur donnee).',
    inputSchema: { ...chute, chute_admissible_pct: z.number().positive().optional().describe('Chute disponible (%) ; sinon limite - amont') },
    annotations: ro,
  }, run((d, a, t) => ct.longueurMax(d, a, t)))

  server.registerTool('nexus_nfc_section_neutre', {
    title: 'NF C 15-100 : section du neutre',
    description: 'Regle de section du neutre (egale, reduite possible, superieure) selon le systeme, la section de phase et le taux d\'harmoniques de rang 3.',
    inputSchema: {
      systeme: z.enum(['mono', 'tri']),
      materiau: z.enum(['Cu', 'Al']),
      section_phase_mm2: z.number().positive(),
      thd_i3_pct: z.number().min(0).optional().describe('Inconnu : la reduction n\'est pas admise'),
      charges_equilibrees: z.boolean().optional(),
      neutre_protege: z.boolean().optional(),
      jeu_donnees: jeu,
    },
    annotations: ro,
  }, run((d, a, t) => {
    const r = iz.regleNeutre(d, { ...a, section_mm2: a.section_phase_mm2 }, t)
    t.etape(`Neutre : ${r.resultat.replace(/_/g, ' ')} (${r.raison})`)
    const sn = d.section_neutre
    if (a.systeme === 'tri' && (a.thd_i3_pct === undefined || a.thd_i3_pct === null)) t.avertir(`Taux d'harmoniques inconnu : ${sn.detection_surcharge_neutre.regle}`)
    return {
      regle: r.resultat,
      raison: r.raison,
      section_neutre_min_mm2: r.resultat === 'neutre_egal_phase' ? a.section_phase_mm2 : null,
      note: r.note || (r.resultat === 'neutre_reduit_possible' ? 'Reduction admise sous conditions : section a dimensionner, neutre protege.' : undefined),
    }
  }))

  server.registerTool('nexus_nfc_mode_pose', {
    title: 'NF C 15-100 : trouver le mode de pose',
    description: 'A partir d\'une description en langage courant (ex. "fourreau enterre", "chemin de cables perfore", "goulotte apparente") '
      + 'ou d\'un numero, renvoie les modes de pose candidats, la methode de reference et le tableau Iz.',
    inputSchema: {
      description: z.string().optional().describe('Description libre de la pose'),
      mode_pose: z.number().int().optional().describe('Numero de mode de pose'),
      jeu_donnees: jeu,
    },
    annotations: ro,
  }, run((d, a, t) => {
    const mp = d.methodes_pose
    t.utilise(mp, mp, null)
    const fiche = (m) => ({
      methode: m.methode, tableau_iz: m.tableau_iz, type_cable: m.type_cable, milieu: m.milieu,
      modes_pose: m.modes_pose, description: m.description,
      tolerance_5pct_admise: m.modes_pose.some((n) => !mp.poses_sans_tolerance_5pct.includes(n)),
      iz_disponible: d.iz_admissible.tableaux.some((x) => x.methode === m.methode),
    })
    if (a.mode_pose !== undefined) {
      const res = mp.methodes.filter((m) => m.modes_pose.includes(a.mode_pose)).map(fiche)
      if (!res.length) throw new iz.ErreurCalcul(`Mode de pose ${a.mode_pose} inconnu.`)
      return { mode_pose: a.mode_pose, tolerance_5pct_admise: !mp.poses_sans_tolerance_5pct.includes(a.mode_pose), candidats: res }
    }
    if (!a.description) return { methodes: mp.methodes.map(fiche), note: mp.note }
    const fuse = new Fuse(mp.methodes.map((m) => ({ m, txt: normalize(`${m.methode} ${m.description} ${m.type_cable} ${m.milieu}`) })), { keys: ['txt'], threshold: 0.6, ignoreLocation: true })
    const res = fuse.search(normalize(a.description)).slice(0, 4).map((r) => fiche(r.item.m))
    return { candidats: res, note: `${mp.note} Confirmer le mode de pose exact avec l'utilisateur si plusieurs candidats.` }
  }))

  server.registerTool('nexus_nfc_tableau', {
    title: 'NF C 15-100 : consulter un tableau',
    description: 'Lecture brute d\'un tableau du jeu de donnees, filtre (ex. tableau "52.8C" section 25 ; "52.12"). Pour verifier une valeur, pas pour calculer.',
    inputSchema: {
      tableau: z.string().describe('Code du tableau : 52.8A ... 52.8H.2, 52.9 ... 52.18, transformateurs, condensateurs, V/A/km'),
      methode: z.string().optional(), materiau: z.enum(['Cu', 'Al']).optional(), isolant: z.enum(['PVC', 'PR']).optional(),
      section_mm2: z.number().optional(), disposition: z.string().optional(),
      jeu_donnees: jeu,
    },
    annotations: ro,
  }, run((d, a, t) => {
    const code = a.tableau.trim().replace(/^tableau\s*/i, '')
    const blocs = [
      ...d.iz_admissible.tableaux,
      ...d.facteurs_correction.tableaux,
      d.transformateurs, d.condensateurs,
      d.chute_tension_tableaux.unitaire, d.chute_tension_tableaux.demarrage_k2,
    ].filter((b) => b.tableau && b.tableau.toLowerCase() === code.toLowerCase() && (!a.methode || !b.methode || b.methode === a.methode))
    if (!blocs.length) throw new iz.ErreurCalcul(`Tableau ${code} absent du jeu ${d.jeu}.`)
    return blocs.map((b) => {
      t.utilise(b, b, null)
      if (b.licence === 'interdit') return { tableau: b.tableau, article: b.article, valeurs: 'Non diffusables (licence) : consulter la norme.' }
      const lignes = b.lignes.filter((l) => (!a.materiau || !l.materiau || l.materiau === a.materiau)
        && (!a.isolant || !l.isolant || l.isolant === a.isolant)
        && (a.section_mm2 === undefined || l.section_mm2 === undefined || l.section_mm2 === a.section_mm2)
        && (!a.disposition || !l.disposition || l.disposition === a.disposition))
      const nv = lignes.filter((l) => l.verif !== 'verifie').length
      if (nv) t.avertir(`${b.tableau} : ${nv} / ${lignes.length} valeur(s) non verifiee(s).`)
      return { tableau: b.tableau, methode: b.methode, grandeur: b.grandeur, page_source: b.page_source, note: b.note, lignes: lignes.slice(0, 400), tronque: lignes.length > 400 || undefined }
    })
  }))

  server.registerTool('nexus_nfc_transformateur', {
    title: 'Transformateur HTA/BT : caracteristiques',
    description: 'Caracteristiques d\'un transformateur HTA/BT 410 V (Ucc, R, X, Z, In, Ik3 aux bornes) pour une puissance du tableau.',
    inputSchema: { puissance_kva: z.number().positive(), jeu_donnees: jeu },
    annotations: ro,
  }, run((d, a, t) => {
    const tr = d.transformateurs
    const l = tr.lignes.find((x) => x.puissance_kva === a.puissance_kva)
    if (!l) throw new iz.ErreurCalcul(`Puissance ${a.puissance_kva} kVA absente. Puissances : ${tr.lignes.map((x) => x.puissance_kva).join(', ')} kVA.`)
    t.utilise(tr, l, `transformateur ${l.puissance_kva} kVA`)
    const inCalc = (l.puissance_kva * 1000) / (l.u_v * Math.sqrt(3))
    t.etape(`In = S / (U x racine 3) = ${l.puissance_kva * 1000} / (${l.u_v} x 1,732) = ${Math.round(inCalc)} A (tableau : ${l.in_a} A)`)
    t.avertir('Ik3 aux bornes sans l\'impedance du reseau amont : valeur majorante.')
    return l
  }))

  server.registerTool('nexus_nfc_a_propos', {
    title: 'NF C 15-100 : etat des donnees',
    description: 'Jeu de donnees actif, sources, taux de verification par tableau et statut de licence. Repond a "peut-on se fier a ce chiffre ?".',
    inputSchema: { jeu_donnees: jeu },
    annotations: ro,
  }, async (args = {}) => {
    try {
      const d = store.charger(args.jeu_donnees)
      const blocs = [
        ...d.iz_admissible.tableaux.map((b) => ({ ...b, tableau: `${b.tableau} (${b.methode})` })),
        ...d.facteurs_correction.tableaux, d.transformateurs, d.condensateurs,
        d.chute_tension_tableaux.unitaire, d.chute_tension_tableaux.demarrage_k2,
      ]
      const parTableau = blocs.map((b) => ({
        tableau: b.tableau,
        verifiees: b.lignes.filter((l) => l.verif === 'verifie').length,
        total: b.lignes.length,
        ecarts: b.lignes.filter((l) => l.verif === 'ecart').length || undefined,
        licence: b.licence,
      }))
      const total = parTableau.reduce((s, x) => s + x.total, 0)
      const ok = parTableau.reduce((s, x) => s + x.verifiees, 0)
      return text({
        jeu_actif: store.jeuActif(),
        jeu_consulte: d.jeu,
        jeux_disponibles: store.listeJeux(),
        manifeste: d.manifest,
        sources: d.sources.sources,
        verification: { verifiees: ok, total, pct: total ? Math.round((1000 * ok) / total) / 10 : 0, par_tableau: parTableau },
        avis: 'Les valeurs marquees non verifiees viennent d\'une recopie du support de formation et doivent etre confirmees sur la norme.',
      })
    } catch (error) {
      return fail(error.message || String(error))
    }
  })

  return { instructions: INSTRUCTIONS, store }
}

module.exports = { registerNfcTools, INSTRUCTIONS }
