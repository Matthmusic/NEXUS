export interface Cable {
  row: number
  designation: string
  pu_materiel_eur_ml: number
  marge: number
  tps_pose: number
  pu_pose: number
  categorie: string
}

export interface DevisLine {
  id: number
  label: string
  refRef: string
  prixAchat: number
  marge: number
  ptMat: number
  tpsPose: number
  taux: number
  ptPose: number
  prixPose: number
  qty: number
}

export interface CalcSession {
  name: string
  savedAt: string
  corrType: string
  corrSection: string
  corrRefRef: string
  corrMarge: number
  corrTaux: number
  corrQty: number
}

export type Overrides = Record<number, { marge?: number; taux?: number }>
