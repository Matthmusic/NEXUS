/**
 * Lecture des tableaux Markdown de la fiche de synthese NF C 15-100.
 * Aucune valeur normative ici : uniquement du decoupage de texte.
 */

/** "1,5" -> 1.5 ; "3 525" -> 3525 ; "–" -> null */
function num(text) {
  if (text === undefined || text === null) return null
  const clean = String(text).replace(/\*/g, '').replace(/\s/g, '').replace(',', '.')
  if (clean === '' || clean === '–' || clean === '-') return null
  const value = Number(clean)
  return Number.isFinite(value) ? value : null
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

/**
 * Renvoie le premier tableau qui suit le titre dont le texte contient `headingText`.
 * { heading, headers, rows }
 */
function tableAfter(md, headingText) {
  const lines = md.split(/\r?\n/)
  // titre Markdown (##) ou paragraphe en gras servant de titre (**...**)
  const start = lines.findIndex((l) => (/^#{2,4}\s/.test(l) || l.startsWith('**')) && l.includes(headingText))
  if (start < 0) throw new Error(`Titre introuvable dans la fiche : ${headingText}`)
  let i = start + 1
  while (i < lines.length && !lines[i].startsWith('|')) {
    if (/^#{2,4}\s/.test(lines[i])) throw new Error(`Pas de tableau sous : ${headingText}`)
    i += 1
  }
  const headers = splitRow(lines[i])
  i += 2 // ligne de separation
  const rows = []
  while (i < lines.length && lines[i].startsWith('|')) {
    rows.push(splitRow(lines[i]))
    i += 1
  }
  return { heading: lines[start].replace(/^#+\s*/, '').replace(/\*\*/g, ''), headers, rows }
}

/** "p. 408" depuis un titre ; renvoie la premiere page citee */
function pageOf(heading) {
  const match = heading.match(/p\.\s*(\d+)/)
  return match ? `p. ${match[1]}` : null
}

module.exports = { num, splitRow, tableAfter, pageOf }
