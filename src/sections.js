import { createHash } from 'node:crypto'

export const hash = (s) => createHash('sha256').update(s).digest('hex')

const HEADING = /^ {0,3}(#{1,6})(?:\s(.*))?$/
// Spec Kit functional requirements and success criteria (`- **FR-001**: ...`, `- **SC-001**: ...`) are confirmed one by one
const REQUIREMENT = /^ {0,3}[-*+] +\*\*((?:FR|SC)-\d+)\*\*/
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/

// shortcut: setext headings (=== / ---) are not split, upgrade if real files use them
export function splitSections(text) {
  const heads = [] // { pos, kind, level, heading }
  let pos = 0
  let fence = null
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const l = line.replace(/\r?\n$/, '')
    if (fence) {
      const m = l.match(FENCE_CLOSE)
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null
    } else if (FENCE_OPEN.test(l)) {
      fence = l.match(FENCE_OPEN)[1]
    } else {
      const m = l.match(HEADING)
      const r = !m && l.match(REQUIREMENT)
      if (m) heads.push({ pos, kind: 'heading', level: m[1].length, heading: (m[2] ?? '').replace(/(^|\s)#+\s*$/, '').trim() })
      else if (r) heads.push({ pos, kind: 'requirement', level: 0, heading: r[1] })
    }
    pos += line.length
  }

  if (!text) return []
  const preamble = { pos: 0, kind: 'preamble', level: 0, heading: '' }
  if (!heads.length) heads.push(preamble)
  else if (heads[0].pos > 0) {
    // whitespace-only preamble is not worth reviewing; fold it into the first section
    if (text.slice(0, heads[0].pos).trim()) heads.unshift(preamble)
    else heads[0].pos = 0
  }

  const seen = new Map()
  return heads.map((h, index) => {
    const end = index + 1 < heads.length ? heads[index + 1].pos : text.length
    const t = text.slice(h.pos, end)
    const k = hash(t)
    const n = seen.get(k) ?? 0
    seen.set(k, n + 1)
    return { index, kind: h.kind, heading: h.heading, level: h.level, start: h.pos, end, text: t, key: `${k}#${n}` }
  })
}
