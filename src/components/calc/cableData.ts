import cablesRaw from '../../assets/cables.json'
import type { Cable } from './types'

export const CABLES = cablesRaw as Cable[]

export const CABLE_CATS = [
  'Câbles industriels rigides', 'Câbles incendie', 'Moyenne tension',
  'Fils et câbles souples', 'Domestique rigide', 'Câbles Spéciaux',
  'Câbles alarmes', 'Câbles téléphoniques',
]

export const SECTION_RE = / (\d+[gGxXjJ]\d+[,.]?\d*)/

export const COND_RE = /\s+(TGL|T500|T250|T100|C50|C100|FUT)\b/i

export function normalizeSection(s: string) {
  return s.toLowerCase().replace(',', '.').replace(/\s/g, '')
}
