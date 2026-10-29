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

// ---------------------------------------------------------------------------
// Temps de pose : valeur du tableau (cables.json) si la section y est, sinon
// estimation par formule ajustee sur ce tableau (ecart max 0,01 h/ml).
// Garder en phase avec electron/mcp-server.cjs.
// ---------------------------------------------------------------------------

export const TPS_POSE_MIN = 0.06

export function estimateTpsPose(cores: number, section: number) {
  const raw = 0.009 + 0.0129 * Math.sqrt(cores * section) + 0.0055 * cores
  return Math.max(TPS_POSE_MIN, Math.round(raw * 100) / 100)
}

// "3G2,5" / "1X240" / "4j6" -> { cores, section }
export function parseSection(text: string): { cores: number; section: number } | null {
  const match = text.replace(/\s/g, '').match(/^(\d+)[gGxXjJ](\d+(?:[.,]\d+)?)$/)
  if (!match) return null
  const cores = Number.parseInt(match[1], 10)
  const section = Number.parseFloat(match[2].replace(',', '.'))
  return cores > 0 && section > 0 ? { cores, section } : null
}

function sectionKey(cores: number, section: number) {
  return `${cores}x${section}`
}

export function findCableSpec(cores: number, section: number): Cable | null {
  const key = sectionKey(cores, section)
  return CABLES.find((cable) => {
    const parsed = parseSection(cable.designation)
    return parsed !== null && sectionKey(parsed.cores, parsed.section) === key
  }) ?? null
}

export function resolveTpsPose(sectionText: string): { tps: number; estimated: boolean; designation: string | null } | null {
  const parsed = parseSection(sectionText)
  if (!parsed) return null
  const spec = findCableSpec(parsed.cores, parsed.section)
  if (spec) return { tps: spec.tps_pose, estimated: false, designation: spec.designation }
  return { tps: estimateTpsPose(parsed.cores, parsed.section), estimated: true, designation: null }
}

export interface CompositionGroup {
  count: number
  cores: number
  section: number
  label: string // ex. "1x240"
  role: string | null // "PE", "N"…
}

// Decompose une liaison du type "4x3x1x240 + PE 240" ou "3x(1x240) + 1x120 N"
// en groupes de cables identiques : 12 x 1x240 + 1 x 1x240 (PE)...
// Les deux derniers nombres d'un terme sont le cable (conducteurs x section),
// ceux d'avant sont des multiplicateurs. Un nombre seul = unipolaire.
export function parseComposition(text: string): CompositionGroup[] | null {
  const terms = text.split('+').map((t) => t.trim()).filter(Boolean)
  if (terms.length === 0) return null
  const groups: CompositionGroup[] = []
  for (const term of terms) {
    const roleMatch = term.match(/\b(PE|PEN|N|T|TERRE)\b/i)
    const role = roleMatch ? roleMatch[1].toUpperCase() : null
    const body = term
      .replace(/\b(PE|PEN|N|T|TERRE)\b/gi, '')
      .replace(/mm2|mm²|²|mm|[()]/gi, '')
      .replace(/\s/g, '')
    if (!body) return null
    const parts = body.split(/[xXgGjJ*×]/)
    if (parts.some((p) => !/^\d+(?:[.,]\d+)?$/.test(p))) return null
    const nums = parts.map((p) => Number.parseFloat(p.replace(',', '.')))
    let count = 1
    let cores = 1
    let section = nums[nums.length - 1]
    if (nums.length >= 2) {
      cores = nums[nums.length - 2]
      count = nums.slice(0, -2).reduce((acc, v) => acc * v, 1)
    }
    if (!Number.isInteger(cores) || !Number.isInteger(count) || cores < 1 || count < 1 || !(section > 0)) return null
    groups.push({ count, cores, section, label: `${cores}x${String(section).replace('.', ',')}`, role })
  }
  return groups
}
