/**
 * Forme commune des reponses des outils nexus_nfc_*.
 * Chaque calcul note ses etapes, ses references et le statut des donnees utilisees.
 */

const AVIS = 'Aide au predimensionnement selon NF C 15-100 : ne remplace pas la note de calcul.'
const ORDRE_VERIF = ['rejete', 'ecart', 'non_verifie', 'verifie']
const ORDRE_LICENCE = ['interdit', 'a_valider', 'autorise']

class Trace {
  constructor(donnees) {
    this.donnees = donnees
    this.calcul = []
    this.references = []
    this.avertissements = []
    this.verif = 'verifie'
    this.licence = 'autorise'
    this.nonVerifiees = []
  }

  etape(texte) {
    this.calcul.push(texte)
  }

  avertir(texte) {
    if (!this.avertissements.includes(texte)) this.avertissements.push(texte)
  }

  /**
   * Note l'usage d'une donnee : bloc = objet portant tableau/article/page/source/licence,
   * ligne = ligne utilisee (portant verif), libelle = description courte pour l'avertissement.
   */
  utilise(bloc, ligne, libelle) {
    const ref = {
      tableau: bloc.tableau || null,
      article: bloc.article || null,
      source: bloc.source || null,
      page_source: bloc.page_source || null,
      edition: this.donnees.manifest.edition_norme || null,
    }
    const key = JSON.stringify(ref)
    if (!this.references.some((r) => JSON.stringify(r) === key)) this.references.push(ref)
    const verif = (ligne && ligne.verif) || bloc.verif || 'non_verifie'
    const licence = bloc.licence || 'a_valider'
    if (ORDRE_VERIF.indexOf(verif) < ORDRE_VERIF.indexOf(this.verif)) this.verif = verif
    if (ORDRE_LICENCE.indexOf(licence) < ORDRE_LICENCE.indexOf(this.licence)) this.licence = licence
    if (verif !== 'verifie' && libelle && this.nonVerifiees.length < 12) this.nonVerifiees.push(libelle)
  }

  reponse(resultat) {
    const avertissements = [...this.avertissements]
    if (this.nonVerifiees.length) {
      avertissements.unshift(`Valeur(s) non encore verifiee(s) contre la norme : ${this.nonVerifiees.join(' ; ')}.`)
    }
    if (this.licence === 'a_valider') {
      avertissements.push('Reprise des tableaux AFNOR en attente de validation (licence) : usage interne uniquement.')
    }
    return {
      resultat,
      calcul: this.calcul,
      references: this.references,
      avertissements,
      statut_donnees: { verification: this.verif, licence: this.licence },
      jeu_donnees: this.donnees.jeu,
      avis: AVIS,
    }
  }
}

/** "1,5" lisible a la francaise pour les etapes de calcul */
function fr(value, digits = 3) {
  if (value === null || value === undefined) return '-'
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits
  return String(rounded).replace('.', ',')
}

module.exports = { Trace, fr, AVIS }
