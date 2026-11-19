/**
 * Tests du module nfc15100 sur un jeu de donnees FICTIF.
 * Les valeurs ci-dessous sont inventees (nombres ronds) : elles ne viennent pas de la norme
 * et ne doivent jamais etre utilisees pour un calcul reel. Les vraies donnees vivent hors du depot.
 *
 * Lancement : npm test   (node --test)
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createStore, FICHIERS, sha256 } = require('../donnees.cjs')
const { Trace } = require('../enveloppe.cjs')
const iz = require('../calculs/iz.cjs')
const ct = require('../calculs/chute-tension.cjs')

const B = { source: 'fictif', licence: 'a_valider' }
const V = 'verifie'

function jeuFictif() {
  const sections = [10, 16, 25, 35]
  const izLignes = (base) => sections.flatMap((s, i) => [
    { materiau: 'Cu', isolant: 'PR', nb_conducteurs_charges: 3, section_mm2: s, iz_a: base + 20 * i, verif: V },
    { materiau: 'Cu', isolant: 'PR', nb_conducteurs_charges: 2, section_mm2: s, iz_a: base + 10 + 20 * i, verif: V },
  ])
  return {
    'sources.json': { sources: [{ id: 'fictif', type: 'interne', titre: 'Donnees de test', edition_norme: 'TEST' }] },
    'methodes_pose.json': {
      tableau: 'poses', ...B, poses_sans_tolerance_5pct: [31], note: '',
      methodes: [
        { methode: 'B1', tableau_iz: 'T-B1', type_cable: 'monoconducteurs_ou_conducteurs', milieu: 'air', temperature_reference_c: 30, modes_pose: [4, 40], description: 'conduit apparent', verif: V },
        { methode: 'B2', tableau_iz: 'T-B2', type_cable: 'multiconducteur', milieu: 'air', temperature_reference_c: 30, modes_pose: [5, 40], description: 'conduit apparent multi', verif: V },
        { methode: 'E', tableau_iz: 'T-E', type_cable: 'multiconducteur', milieu: 'air', temperature_reference_c: 30, modes_pose: [31], description: 'chemin perfore', verif: V },
        { methode: 'F', tableau_iz: 'T-F', type_cable: 'monoconducteurs', milieu: 'air', temperature_reference_c: 30, modes_pose: [31], description: 'chemin perfore mono', verif: V },
        { methode: 'D2', tableau_iz: 'T-D2', type_cable: 'tous', milieu: 'sol', temperature_reference_c: 20, modes_pose: [72], description: 'enterre', verif: 'non_verifie' },
      ],
    },
    'iz_admissible.json': {
      tableaux: [
        { tableau: 'T-B1', methode: 'B1', ...B, lignes: izLignes(50) },
        { tableau: 'T-B2', methode: 'B2', ...B, lignes: izLignes(45) },
        { tableau: 'T-E', methode: 'E', ...B, lignes: izLignes(60) },
        { tableau: 'T-F', methode: 'F', ...B, lignes: izLignes(70).map((l) => (l.nb_conducteurs_charges === 3 ? { ...l, disposition: 'trefle' } : l)) },
        { tableau: 'T-D2', methode: 'D2', ...B, lignes: izLignes(55).map((l) => ({ ...l, verif: 'non_verifie' })) },
      ],
    },
    'facteurs_correction.json': {
      tableaux: [
        { tableau: '52.9', grandeur: 'temperature_air', ...B, lignes: [
          { isolant: 'PR', valeur: 30, coefficient: 1, verif: V }, { isolant: 'PR', valeur: 40, coefficient: 0.9, verif: V }, { isolant: 'PR', valeur: 50, coefficient: 0.8, verif: V }] },
        { tableau: '52.10', grandeur: 'temperature_sol', ...B, lignes: [{ isolant: 'PR', valeur: 20, coefficient: 1, verif: V }, { isolant: 'PR', valeur: 30, coefficient: 0.9, verif: V }] },
        { tableau: '52.11', grandeur: 'resistivite_sol', ...B, lignes: [{ disposition: 'direct_sol', valeur: 1, coefficient: 1.5, verif: V }, { disposition: 'direct_sol', valeur: 2.5, coefficient: 1, verif: V }] },
        { tableau: '52.12', grandeur: 'nb_circuits', ...B, regle_au_dela: {}, lignes: [1, 2, 3, 4].map((n) => ({ disposition: 'groupes_air_surface_noyes', valeur: n, coefficient: 1 - 0.1 * (n - 1), verif: V })) },
        { tableau: '52.13', grandeur: 'nb_cables', ...B, lignes: [1, 2, 3].map((n) => ({ disposition: 'tablette_perforee_horizontale_jointifs', nb_tablettes: 1, valeur: n, coefficient: 1 - 0.05 * (n - 1), verif: V })) },
        { tableau: '52.14', grandeur: 'nb_circuits', ...B, lignes: [
          { disposition: 'tablette_perforee_horizontale_trefle', nb_tablettes: 1, valeur: 1, coefficient: 0.95, verif: V },
          { disposition: 'tablette_perforee_horizontale_nappe', nb_tablettes: 1, valeur: 1, coefficient: 0.9, verif: V }] },
        { tableau: '52.15', grandeur: 'nb_couches', ...B, regle_au_dela: { toutes: 'constant' }, lignes: [{ disposition: 'toutes', valeur: 1, coefficient: 1, verif: V }, { disposition: 'toutes', valeur: 2, coefficient: 0.8, verif: V }] },
        { tableau: '52.16', grandeur: 'nb_circuits', ...B, lignes: [{ disposition: 'jointifs', valeur: 2, coefficient: 0.7, verif: V }, { disposition: 'jointifs', valeur: 3, coefficient: 0.6, verif: V }] },
      ],
    },
    'facteurs_particuliers.json': {
      ...B, facteurs: [
        { id: 'symetrie', max_cables_paralleles_par_phase: 4, au_dela: 'prefabriquee', verif: V, regles: [
          { si: { cables_paralleles_par_phase: [1] }, coefficient: 1 },
          { si: { cables_paralleles_par_phase: [2, 4], disposition_conforme: true }, coefficient: 1 },
          { si: { cables_paralleles_par_phase: [2, 4], disposition_conforme: false }, coefficient: 0.7 },
          { si: { cables_paralleles_par_phase: [3] }, coefficient: 0.7 },
          { si: { type_cable: 'multiconducteur' }, coefficient: 1 }] },
        { id: 'neutre_charge', coefficient: 0.5, seuil_thd_i3_pct: 15, verif: V },
        { id: 'be3', coefficient: 0.5, verif: V },
        { id: 'tolerance_iz', tolerance_pct: 5, poses_exclues: [31], verif: V },
      ],
    },
    'section_neutre.json': {
      tableau: 'neutre', ...B, verif: V,
      regles: [
        { resultat: 'neutre_superieur_phase', si: { thd_i3_pct_sup: 33 } },
        { resultat: 'neutre_egal_phase', si: { systeme: 'mono' } },
        { resultat: 'neutre_egal_phase', si: { thd_i3_pct_sup: 15, thd_i3_pct_max: 33 } },
        { resultat: 'neutre_egal_phase', si: { section_max: { Cu: 16, Al: 25 } } },
        { resultat: 'neutre_reduit_possible', si: { section_sup: { Cu: 16, Al: 25 }, thd_i3_pct_max: 15, charges_equilibrees: true, neutre_protege: true } },
      ],
      detection_surcharge_neutre: { regle: 'test' },
    },
    'resistivites.json': { ...B, reactance_lineique_mohm_m: 0, tableaux: [{ tableau: 'rho', lignes: [{ usage: 'chute_tension', Cu: 0.02, Al: 0.03, verif: V }] }] },
    'chute_tension_regles.json': { tableau: 'limites', ...B, verif: V, limite_demarrage_moteur_pct: 15, limites: [{ type_alimentation: 'A', usage: 'autres', limite_pct: 5 }, { type_alimentation: 'A', usage: 'eclairage', limite_pct: 3 }] },
    'chute_tension_tableaux.json': {
      unitaire: { tableau: 'V/A/km', ...B, lignes: [{ systeme: 'mono', materiau: 'Cu', section_mm2: 10, cos_phi: 1, v_par_a_km: 4, verif: V }] },
      demarrage_k2: { tableau: 'K2', ...B, lignes: [{ isource_sur_id: 2, id_sur_in: 4, k2: 2, verif: V }, { isource_sur_id: 4, id_sur_in: 4, k2: 1.5, verif: V }] },
    },
    'courant_protection.json': {
      tableau: 'protection', ...B, verif: V,
      disjoncteur: { coefficient: 1 }, fusible: { si_in_inferieur_a_16: 1.3, si_in_superieur_a_16: 1.1, in_egal_16: 'test' },
      calibres_normalises_a: [10, 16, 20, 25, 32, 40, 50, 63, 80, 100],
    },
    'transformateurs.json': { tableau: 'transformateurs', ...B, lignes: [] },
    'condensateurs.json': { tableau: 'condensateurs', ...B, lignes: [] },
  }
}

function installer(modif = (x) => x) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nfc-test-'))
  const dir = path.join(root, 'jeux', 'test.1')
  fs.mkdirSync(dir, { recursive: true })
  const data = modif(jeuFictif())
  const fichiers = {}
  for (const name of FICHIERS) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(data[name]))
    fichiers[name] = sha256(path.join(dir, name))
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ jeu: 'test.1', edition_norme: 'TEST', fichiers }))
  fs.writeFileSync(path.join(root, 'actif.json'), JSON.stringify({ jeu: 'test.1' }))
  return { root, dir, store: createStore(() => root) }
}

const calc = (fn, p, ctx = installer()) => {
  const d = ctx.store.charger()
  const t = new Trace(d)
  return { r: fn(d, p, t), rep: t.reponse(null) }
}

const base = { materiau: 'Cu', isolant: 'PR', systeme: 'tri' }

test('section minimale : plus petite section avec Iz x K >= In', () => {
  // B1 tri : Iz 50 / 70 / 90 / 110 ; IB 65 -> calibre 80 -> 16 mm² (70 A) ne suffit pas, 25 mm² (90 A) oui
  const { r } = calc(iz.sectionMinimale, { ...base, courant_emploi_a: 65, mode_pose: 4 })
  assert.equal(r.protection.calibre_a, 80)
  assert.equal(r.section_phase_mm2, 25)
  assert.equal(r.k_total, 1)
  assert.equal(r.sections_voisines.inferieure.section_mm2, 16)
})

test('facteurs : temperature entre deux lignes -> ligne superieure (defavorable)', () => {
  const { r, rep } = calc(iz.sectionMinimale, { ...base, courant_emploi_a: 40, protection: { type: 'disjoncteur', calibre_a: 40 }, mode_pose: 4, temperature_c: 35, groupement: { nb_circuits: 2 } })
  assert.equal(r.facteurs.temperature, 0.9) // 35 °C -> ligne 40 °C
  assert.equal(r.facteurs.groupement, 0.9)
  assert.equal(r.k_total, 0.81)
  assert.equal(r.section_phase_mm2, 16) // 40 / 0,81 = 49,4 A ; 10 mm² = 50 x 0,81 = 40,5 -> insuffisant
  assert.ok(rep.calcul.some((e) => e.includes('cote defavorable')))
})

test('mode de pose ambigu sans type de cable : erreur explicite', () => {
  assert.throws(() => calc(iz.sectionMinimale, { ...base, courant_emploi_a: 20, mode_pose: 40 }), /preciser type_cable/)
  const { r } = calc(iz.sectionMinimale, { ...base, courant_emploi_a: 20, mode_pose: 40, type_cable: 'multiconducteur' })
  assert.equal(r.methode, 'B2')
})

test('fusible : coefficient applique selon le calibre', () => {
  const { r } = calc(iz.sectionMinimale, { ...base, courant_emploi_a: 30, mode_pose: 4, protection: { type: 'fusible', calibre_a: 32 } })
  assert.equal(r.protection.courant_a, 32 * 1.1)
})

test('calibre inferieur a IB : refus', () => {
  assert.throws(() => calc(iz.sectionMinimale, { ...base, courant_emploi_a: 50, mode_pose: 4, protection: { type: 'disjoncteur', calibre_a: 40 } }), /IB <= In/)
})

test('enterre : resistivite, groupement par defaut jointifs, donnee non verifiee signalee', () => {
  const { r, rep } = calc(iz.sectionMinimale, { ...base, courant_emploi_a: 60, mode_pose: 72, resistivite_sol: 1, groupement: { nb_circuits: 2 } })
  assert.equal(r.facteurs.resistivite_sol, 1.5)
  assert.equal(r.facteurs.groupement, 0.7)
  assert.equal(rep.statut_donnees.verification, 'non_verifie')
  assert.ok(rep.avertissements.some((a) => a.includes('jointifs')))
  assert.ok(rep.avertissements[0].startsWith('Valeur(s) non encore verifiee(s)'))
})

test('hors tableau : nombre de circuits au-dela de la derniere ligne', () => {
  assert.throws(() => calc(iz.sectionMinimale, { ...base, courant_emploi_a: 20, mode_pose: 4, groupement: { nb_circuits: 9 } }), /Hors du domaine/)
})

test('plusieurs couches : constant au-dela du tableau', () => {
  const { r } = calc(iz.sectionMinimale, { ...base, courant_emploi_a: 20, mode_pose: 4, groupement: { nb_couches: 5 } })
  assert.equal(r.facteurs.couches, 0.8)
})

test('cables en parallele : Iz requis divise, composition pour nexus_cable_price', () => {
  const { r } = calc(iz.sectionMinimale, { ...base, courant_emploi_a: 95, mode_pose: 4, cables_paralleles_par_phase: 2 })
  assert.equal(r.protection.calibre_a, 100)
  assert.equal(r.section_phase_mm2, 10) // 100 / 2 = 50 A par cable
  assert.equal(r.pour_chiffrage.composition, '2x3x1x10 + 2x1x10 N')
  assert.equal(r.facteurs.symetrie, 1)
  const trois = calc(iz.sectionMinimale, { ...base, courant_emploi_a: 95, mode_pose: 4, cables_paralleles_par_phase: 3 }).r
  assert.equal(trois.facteurs.symetrie, 0.7)
  const nonConforme = calc(iz.sectionMinimale, { ...base, courant_emploi_a: 95, mode_pose: 4, cables_paralleles_par_phase: 2, disposition_paralleles_conforme: false }).r
  assert.equal(nonConforme.facteurs.symetrie, 0.7)
  assert.throws(() => calc(iz.sectionMinimale, { ...base, courant_emploi_a: 95, mode_pose: 4, cables_paralleles_par_phase: 5 }), /prefabriquee/)
})

test('tolerance 5 % refusee pour une pose exclue', () => {
  const { rep } = calc(iz.sectionMinimale, { ...base, courant_emploi_a: 20, mode_pose: 31, type_cable: 'multiconducteur', tolerance_5pct: true })
  assert.ok(rep.avertissements.some((a) => a.includes('Tolerance de 5 % refusee')))
})

test('neutre : reduction refusee si les conditions ne sont pas confirmees', () => {
  const d = installer().store.charger()
  const t = new Trace(d)
  assert.equal(iz.regleNeutre(d, { systeme: 'tri', materiau: 'Cu', section_mm2: 25, thd_i3_pct: 10 }, t).resultat, 'neutre_egal_phase')
  assert.equal(iz.regleNeutre(d, { systeme: 'tri', materiau: 'Cu', section_mm2: 25, thd_i3_pct: 10, charges_equilibrees: true, neutre_protege: true }, t).resultat, 'neutre_reduit_possible')
  assert.equal(iz.regleNeutre(d, { systeme: 'tri', materiau: 'Cu', section_mm2: 25, thd_i3_pct: 40 }, t).resultat, 'neutre_superieur_phase')
  assert.equal(iz.regleNeutre(d, { systeme: 'mono', materiau: 'Cu', section_mm2: 25 }, t).resultat, 'neutre_egal_phase')
})

test('chute de tension mono : formule, limite, controle par le tableau', () => {
  // mono, rho 0,02, lambda 0, cos 1 : u = 2 x 0,02 x 100 / 10 x 20 = 8 V -> 3,48 %
  const { r } = calc(ct.chuteTension, { systeme: 'mono', materiau: 'Cu', section_mm2: 10, longueur_m: 100, courant_a: 20, cos_phi: 1 })
  assert.equal(r.chute_v, 8)
  assert.equal(r.chute_pct, 3.48)
  assert.equal(r.conforme, true)
  assert.equal(r.controle_tableau.tableau_v_par_a_km, 4)
  assert.equal(r.controle_tableau.ecart_pct, 0)
})

test('chute de tension tri : volts entre phases, pourcentage sur 400 V', () => {
  const { r } = calc(ct.chuteTension, { systeme: 'tri', materiau: 'Cu', section_mm2: 10, longueur_m: 100, courant_a: 20, cos_phi: 1 })
  assert.equal(r.chute_v, Math.round(4 * Math.sqrt(3) * 100) / 100)
  assert.equal(r.chute_pct, Math.round((400 / 230) * 100) / 100)
})

test('demarrage moteur : K2 du cote defavorable', () => {
  const { r } = calc(ct.chuteTension, { systeme: 'tri', materiau: 'Cu', section_mm2: 10, longueur_m: 100, courant_a: 20, cos_phi: 1, demarrage_moteur: { id_sur_in: 4, isource_sur_id: 3 } })
  assert.equal(r.demarrage.k2, 2) // Isource/Id 3 -> ligne 2
})

test('longueur maximale', () => {
  const { r } = calc(ct.longueurMax, { systeme: 'mono', materiau: 'Cu', section_mm2: 10, courant_a: 20, cos_phi: 1 })
  // 5 % x 230 / (0,004 V/A/m x 20) = 143,75 m
  assert.equal(r.longueur_max_m, 143)
})

test('donnees : un fichier modifie apres publication est refuse', () => {
  const ctx = installer()
  fs.appendFileSync(path.join(ctx.dir, 'iz_admissible.json'), ' ')
  assert.throws(() => ctx.store.charger(), /modifie apres publication/)
})

test('donnees : jeu inconnu et nom invalide', () => {
  const ctx = installer()
  assert.throws(() => ctx.store.charger('2099.9'), /introuvable/)
  assert.throws(() => ctx.store.charger('../x'), /invalide/)
})

test('methode F : meme disposition par defaut pour Iz et pour le groupement', () => {
  const { r, rep } = calc(iz.courantAdmissible, { ...base, section_mm2: 10, mode_pose: 31, type_cable: 'monoconducteurs' })
  assert.equal(r.methode, 'F')
  assert.equal(r.facteurs.groupement, 0.95) // 52.14 trefle, comme la colonne Iz
  assert.ok(rep.calcul.some((e) => e.includes('tablette_perforee_horizontale_trefle')))
})
