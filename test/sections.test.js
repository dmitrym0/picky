import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitSections, hash } from '../src/sections.js'

const roundTrip = (text) => {
  const s = splitSections(text)
  assert.equal(s.map((x) => x.text).join(''), text)
  let pos = 0
  for (const x of s) {
    assert.equal(x.start, pos)
    assert.equal(text.slice(x.start, x.end), x.text)
    pos = x.end
  }
  assert.equal(pos, text.length)
  return s
}

test('round-trips exactly, including CRLF and no trailing newline', () => {
  roundTrip('# A\n\nbody\n\n## B\nmore\n')
  roundTrip('# A\r\nbody\r\n## B\r\nmore')
  roundTrip('intro\n# A\nx')
  roundTrip('\n\n# A\nx\n')
})

test('preamble becomes level-0 section; omitted when empty', () => {
  const s = roundTrip('intro text\n\n# Title\nbody\n')
  assert.equal(s.length, 2)
  assert.deepEqual([s[0].level, s[0].heading], [0, ''])
  assert.deepEqual([s[1].level, s[1].heading], [1, 'Title'])
  assert.equal(roundTrip('# Title\nbody\n').length, 1)
})

test('whitespace-only preamble is folded into the first section', () => {
  const s = roundTrip('\n\n# Title\nbody\n')
  assert.equal(s.length, 1)
  assert.equal(s[0].heading, 'Title')
})

test('no headings is one section; empty is none', () => {
  assert.equal(roundTrip('just text\nmore\n').length, 1)
  assert.deepEqual(splitSections(''), [])
})

test('heading levels, text, and leading spaces', () => {
  const s = roundTrip('# One\n## Two ##\n###### Six\n   ### Indented\n#\n')
  assert.deepEqual(s.map((x) => [x.level, x.heading]), [[1, 'One'], [2, 'Two'], [6, 'Six'], [3, 'Indented'], [1, '']])
})

test('non-headings do not split', () => {
  assert.equal(roundTrip('# A\n#hashtag\n    # code\n####### seven\n').length, 1)
})

test('fenced code blocks do not split', () => {
  assert.equal(roundTrip('# A\n```sh\n# comment\n```\nafter\n').length, 1)
  assert.equal(roundTrip('# A\n~~~\n# comment\n~~~\n').length, 1)
  // 3 backticks do not close a 4-backtick fence
  assert.equal(roundTrip('# A\n````\n```\n# still code\n````\n# B\n').length, 2)
  // tildes do not close a backtick fence
  assert.equal(roundTrip('# A\n```\n~~~\n# still code\n```\n').length, 1)
})

test('identical sections get distinct keys', () => {
  const s = roundTrip('## X\nsame\n## X\nsame\n')
  assert.equal(s[0].key, hash('## X\nsame\n') + '#0')
  assert.equal(s[1].key, hash('## X\nsame\n') + '#1')
})

test('index is sequential', () => {
  assert.deepEqual(roundTrip('a\n# b\n# c\n').map((x) => x.index), [0, 1, 2])
})

test('each FR-xxx and SC-xxx list item is its own requirement section', () => {
  const text = [
    '### Functional Requirements\n',
    '\n',
    '- **FR-001**: System MUST do one.\n',
    '- **FR-002**: System MUST do two,\n',
    '  wrapped onto a second line.\n',
    '* **FR-003** star bullet\n',
    '- **SC-001**: Users finish in under a minute.\n',
    '\n',
    '```\n- **FR-999**: inside a fence\n```\n',
    '- not a requirement\n',
    '## Next\n',
  ].join('')
  const s = roundTrip(text)
  assert.deepEqual(s.map((x) => [x.kind, x.heading]), [
    ['heading', 'Functional Requirements'],
    ['requirement', 'FR-001'],
    ['requirement', 'FR-002'],
    ['requirement', 'FR-003'],
    ['requirement', 'SC-001'],
    ['heading', 'Next'],
  ])
  assert.equal(s[2].text, '- **FR-002**: System MUST do two,\n  wrapped onto a second line.\n')
  assert.match(s[4].text, /FR-999.*\n```\n- not a requirement\n$/s)
})

test('preamble kind', () => {
  assert.equal(roundTrip('intro\n# A\n')[0].kind, 'preamble')
  assert.equal(roundTrip('no headings\n')[0].kind, 'preamble')
})
