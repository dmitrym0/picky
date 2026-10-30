import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { start } from '../src/server.js'

const SPEC = '# Spec\nintro\n\n## A\naaa\n\n## B\nbbb\n\n## C\nccc\n'

// a temp project with its own review store; returns helpers bound to a running server
async function setup(t, files = { 'specs/001-x/spec.md': SPEC }, { open = '.' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'picky-'))
  const root = path.join(tmp, 'proj')
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
  fs.mkdirSync(root, { recursive: true })
  process.env.PICKY_STORE = path.join(tmp, 'reviews.json')
  let server = await start({ port: 0, dir: path.join(root, open) })
  t.after(() => server.close())
  const real = fs.realpathSync(root)
  const ctx = {
    root: real,
    port: () => server.address().port,
    file: (rel) => path.join(real, rel),
    store: () => JSON.parse(fs.readFileSync(process.env.PICKY_STORE, 'utf8')),
    async req(method, url, body, headers = { 'Content-Type': 'application/json' }) {
      const r = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
        method,
        headers: body === undefined ? {} : headers,
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      })
      return { status: r.status, data: await r.json().catch(() => null) }
    },
    get: (rel) => ctx.req('GET', `/api/file?path=${encodeURIComponent(ctx.file(rel))}`),
    mark: (rel, key, read = true) => ctx.req('POST', '/api/mark', { path: ctx.file(rel), key, read }),
    async restart(dir = root) {
      server.close()
      server = await start({ port: 0, dir })
    },
  }
  return ctx
}

const F = 'specs/001-x/spec.md'

// ---- US1: review and roll-up ----

test('file opens with every section unread', async (t) => {
  const c = await setup(t)
  const { status, data } = await c.get(F)
  assert.equal(status, 200)
  assert.deepEqual([data.total, data.read, data.reviewed], [4, 0, false])
  assert.ok(data.sections.every((s) => !s.read))
})

test('mark and unmark change the count; all read is reviewed, in the list too', async (t) => {
  const c = await setup(t)
  const { data } = await c.get(F)
  assert.equal((await c.mark(F, data.sections[1].key)).data.read, 1)
  assert.equal((await c.mark(F, data.sections[1].key, false)).data.read, 0)
  let v
  for (const s of data.sections) v = (await c.mark(F, s.key)).data
  assert.equal(v.reviewed, true)
  const entry = (await c.req('GET', '/api/dir')).data.files.find((f) => f.rel === '001-x/spec.md')
  assert.deepEqual([entry.read, entry.total, entry.reviewed, entry.folder], [4, 4, true, '001-x'])
  assert.equal(entry.sections, undefined)
})

test('read marks survive a restart', async (t) => {
  const c = await setup(t)
  const { data } = await c.get(F)
  await c.mark(F, data.sections[0].key)
  await c.mark(F, data.sections[2].key)
  await c.restart()
  const after = (await c.get(F)).data
  assert.deepEqual(after.sections.map((s) => s.read), [true, false, true, false])
})

test('outside change resets only the changed section and prunes its key', async (t) => {
  const c = await setup(t)
  const { data } = await c.get(F)
  for (const s of data.sections) await c.mark(F, s.key)
  fs.writeFileSync(c.file(F), SPEC.replace('bbb', 'BBB changed'))
  const after = (await c.get(F)).data
  assert.deepEqual(after.sections.map((s) => s.read), [true, true, false, true])
  assert.ok(!c.store()[c.file(F)].includes(data.sections[2].key))
})

test('deleted file is 404 and its progress is dropped', async (t) => {
  const c = await setup(t)
  const { data } = await c.get(F)
  await c.mark(F, data.sections[0].key)
  fs.unlinkSync(c.file(F))
  assert.equal((await c.get(F)).status, 404)
  assert.equal(c.store()[c.file(F)], undefined)
})

test('403 for non-markdown and for paths outside the scan root', async (t) => {
  const c = await setup(t, { [F]: SPEC, 'specs/notes.txt': 'x', 'README.md': '# r' })
  assert.equal((await c.get('specs/notes.txt')).status, 403)
  assert.equal((await c.get('README.md')).status, 403) // outside specs/
  assert.equal((await c.get('specs/../../etc.md')).status, 403)
})

test('bad Host header is 403; non-JSON POST is 415', async (t) => {
  const c = await setup(t)
  // fetch() won't let us set Host, so use http.request
  const status = await new Promise((resolve, reject) =>
    http
      .get({ host: '127.0.0.1', port: c.port(), path: '/api/dir', headers: { Host: 'evil.com' } }, (r) => resolve(r.statusCode))
      .on('error', reject),
  )
  assert.equal(status, 403)
  assert.equal((await c.req('POST', '/api/mark', '{}', { 'Content-Type': 'text/plain' })).status, 415)
})

// ---- US2: edit in place ----

const save = (c, view, i, text, extra = {}) => {
  const s = view.sections[i]
  return c.req('POST', '/api/save', { path: view.path, hash: view.hash, start: s.start, end: s.end, text, ...extra })
}

test('save splices only the edited section and marks it read', async (t) => {
  const c = await setup(t)
  const before = fs.readFileSync(c.file(F))
  const v = (await c.get(F)).data
  const s = v.sections[2]
  const r = await save(c, v, 2, '## B\nbbb edited\n\n')
  assert.equal(r.status, 200)
  const expected = Buffer.from(before.toString().slice(0, s.start) + '## B\nbbb edited\n\n' + before.toString().slice(s.end))
  assert.ok(fs.readFileSync(c.file(F)).equals(expected))
  assert.deepEqual(r.data.sections.map((x) => x.read), [false, false, true, false])
})

test('edit that adds a heading marks both new sections read, others untouched', async (t) => {
  const c = await setup(t)
  let v = (await c.get(F)).data
  v = (await c.mark(F, v.sections[3].key)).data
  const r = await save(c, v, 1, '## A\naaa\n\n## A2\nnew\n\n')
  assert.deepEqual(r.data.sections.map((x) => [x.heading, x.read]), [
    ['Spec', false], ['A', true], ['A2', true], ['B', false], ['C', true],
  ])
})

test('stale hash is 409 and nothing is written', async (t) => {
  const c = await setup(t)
  const v = (await c.get(F)).data
  fs.writeFileSync(c.file(F), SPEC + 'outside edit\n')
  const r = await save(c, v, 1, '## A\nmine\n')
  assert.equal(r.status, 409)
  assert.ok(r.data.view.hash)
  assert.equal(fs.readFileSync(c.file(F), 'utf8'), SPEC + 'outside edit\n')
})

test('bad ranges are 400', async (t) => {
  const c = await setup(t)
  const v = (await c.get(F)).data
  for (const [start, end] of [[5, 2], [0, 10_000], [1.5, 3], ['0', 3]])
    assert.equal((await c.req('POST', '/api/save', { path: v.path, hash: v.hash, start, end, text: 'x' })).status, 400)
})

test('read-only file is 500 and the store is unchanged', { skip: process.getuid?.() === 0 }, async (t) => {
  const c = await setup(t)
  let v = (await c.get(F)).data
  v = (await c.mark(F, v.sections[0].key)).data
  const storeBefore = c.store()
  fs.chmodSync(c.file(F), 0o444)
  t.after(() => fs.chmodSync(c.file(F), 0o644))
  const r = await save(c, v, 1, '## A\nx\n')
  assert.equal(r.status, 500)
  assert.match(r.data.error, /Could not save/)
  assert.deepEqual(c.store(), storeBefore)
})

// ---- US3: directories ----

const TREE = {
  [F]: SPEC,
  'specs/001-x/plan.md': '# Plan\n',
  'specs/001-x/checklists/requirements.md': '# Req\n',
  'specs/top.md': '# Top\n',
  'specs/.hidden/x.md': '# no\n',
  'specs/node_modules/y.md': '# no\n',
  '.specify/templates/t.md': '# no\n',
}

test('project root lists only specs/, skipping hidden and node_modules', async (t) => {
  const c = await setup(t, TREE)
  const { files, scanRoot } = (await c.req('GET', '/api/dir')).data
  assert.equal(scanRoot, path.join(c.root, 'specs'))
  assert.deepEqual(files.map((f) => [f.rel, f.folder]), [
    ['001-x/checklists/requirements.md', '001-x/checklists'],
    ['001-x/plan.md', '001-x'],
    ['001-x/spec.md', '001-x'],
    ['top.md', ''],
  ])
})

test('opening a bad path is 400 and keeps the previous directory', async (t) => {
  const c = await setup(t)
  const r = await c.req('POST', '/api/dir', { path: path.join(c.root, 'nope') })
  assert.equal(r.status, 400)
  assert.equal((await c.req('GET', '/api/dir')).data.root, c.root)
})

test('~ expands to the home folder', async (t) => {
  const c = await setup(t)
  const home = process.env.HOME
  process.env.HOME = c.file('specs') // os.homedir() reads HOME; keeps the test off the real home folder
  t.after(() => (process.env.HOME = home))
  const r = await c.req('POST', '/api/dir', { path: '~/001-x' })
  assert.equal(r.status, 200)
  assert.equal(r.data.root, c.file('specs/001-x'))
})

test('same file opened via root and via feature folder shows the same progress', async (t) => {
  const c = await setup(t)
  const v = (await c.get(F)).data
  await c.mark(F, v.sections[0].key)
  const r = await c.req('POST', '/api/dir', { path: c.file('specs/001-x') })
  const entry = r.data.files.find((f) => f.rel === 'spec.md')
  assert.equal(entry.read, 1)
  assert.equal(entry.path, c.file(F))
})

test('empty directory lists no files', async (t) => {
  const c = await setup(t, {})
  const r = (await c.req('GET', '/api/dir')).data
  assert.deepEqual([r.root, r.files], [c.root, []])
})

// ---- US4: ask an existing Claude session about selected text ----

const FORK = '11111111-1111-4111-8111-111111111111'
const ORIG = '22222222-2222-4222-8222-222222222222'

// fake HOME with one Claude Code session for the project, and a fake `claude` that echoes what it got
function fakeClaude(t, c) {
  const home = path.dirname(c.root)
  const proj = path.join(home, '.claude', 'projects', c.root.replace(/[^a-zA-Z0-9]/g, '-'))
  fs.mkdirSync(proj, { recursive: true })
  fs.writeFileSync(
    path.join(proj, `${ORIG}.jsonl`),
    [
      { type: 'user', cwd: c.root, sessionId: ORIG, message: { role: 'user', content: 'hi' } },
      { type: 'ai-title', aiTitle: 'Auto title' },
      { type: 'custom-title', customTitle: 'my "named" session' },
    ].map((o) => JSON.stringify(o)).join('\n') + '\n',
  )
  const bin = path.join(home, 'fake-claude.js')
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === 'agents') {
  console.log(JSON.stringify([
    { name: 'far', cwd: '/elsewhere', kind: 'interactive', status: 'idle', startedAt: 3, sessionId: 'a' },
    { name: 'near', cwd: ${JSON.stringify(c.root)}, kind: 'interactive', status: 'busy', startedAt: 1, sessionId: 'b' },
    { name: 'twin', cwd: '/x', kind: 'interactive', status: 'idle', startedAt: 2, sessionId: 'c' },
    { name: 'twin', cwd: '/y', kind: 'interactive', status: 'idle', startedAt: 2, sessionId: 'c' },
  ]))
  process.exit(0)
}
if (args.includes('--input-format')) {
  // long-lived relay: ack each send, then pretend the target answered
  const seen = []
  const out = (result) => console.log(JSON.stringify({ type: 'result', is_error: false, result }))
  require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
    const text = JSON.parse(line).message.content
    seen.push(text)
    fs.writeFileSync(${JSON.stringify(path.join(path.dirname(c.root), 'relay.json'))}, JSON.stringify({ args, seen }))
    if (text.includes('FAILME')) return out('FAILED: no such session')
    out('SENT')
    setTimeout(() => out('REPLY: answer ' + seen.length + '\\nsecond line'), 20)
  })
  return
}
let input = ''
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  const result = JSON.stringify({ args, input, cwd: process.cwd() })
  console.log(JSON.stringify({ type: 'result', is_error: false, result, session_id: '${FORK}' }))
})
`,
  )
  fs.chmodSync(bin, 0o755)
  const saved = { HOME: process.env.HOME, PICKY_CLAUDE: process.env.PICKY_CLAUDE }
  Object.assign(process.env, { HOME: home, PICKY_CLAUDE: bin })
  t.after(() => Object.assign(process.env, saved))
}

test('lists the Claude sessions of the opened directory, also from a subfolder', async (t) => {
  const c = await setup(t)
  fakeClaude(t, c)
  const r = await c.req('GET', '/api/sessions')
  assert.equal(r.status, 200)
  assert.deepEqual(r.data.sessions.map((s) => [s.id, s.title, s.cwd]), [[ORIG, 'my "named" session', c.root]])
  // untitled sessions fall back to their first prompt
  const f = path.join(path.dirname(c.root), '.claude', 'projects', c.root.replace(/[^a-zA-Z0-9]/g, '-'), `${ORIG}.jsonl`)
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n')[0] + '\n')
  assert.equal((await c.req('GET', '/api/sessions')).data.sessions[0].title, 'hi')
  await c.req('POST', '/api/dir', { path: c.file('specs/001-x') })
  assert.equal((await c.req('GET', '/api/sessions')).data.sessions.length, 1)
})

test('ask forks the original session read-only, then follow-ups continue the fork', async (t) => {
  const c = await setup(t)
  fakeClaude(t, c)
  const first = await c.req('POST', '/api/ask', { session: ORIG, question: 'why?', selection: 'FR-001 text', file: '001-x/spec.md' })
  assert.equal(first.status, 200)
  assert.equal(first.data.session, FORK)
  const got = JSON.parse(first.data.answer)
  assert.deepEqual(got.args.slice(0, 4), ['-p', '--resume', ORIG, '--fork-session'])
  assert.ok(got.args.includes('plan'))
  assert.match(got.input, /001-x\/spec\.md[\s\S]*FR-001 text[\s\S]*why\?/)
  assert.equal(fs.realpathSync(got.cwd), c.root)

  const next = JSON.parse((await c.req('POST', '/api/ask', { session: FORK, question: 'and?' })).data.answer)
  assert.deepEqual(next.args.slice(0, 3), ['-p', '--resume', FORK])
  assert.ok(!next.args.includes('--fork-session'))
  assert.equal(next.input, 'and?')
})

test('ask rejects bad input', async (t) => {
  const c = await setup(t)
  fakeClaude(t, c)
  assert.equal((await c.req('POST', '/api/ask', { session: 'x; rm -rf /', question: 'q' })).status, 400)
  assert.equal((await c.req('POST', '/api/ask', { session: ORIG, question: '  ' })).status, 400)
  assert.equal((await c.req('POST', '/api/ask', { session: FORK, question: 'q' })).status, 404) // not listed, not ours
})

test('lists live sessions, related ones first, shared names flagged', async (t) => {
  const c = await setup(t)
  fakeClaude(t, c)
  const r = await c.req('GET', '/api/live')
  assert.equal(r.status, 200)
  assert.deepEqual(r.data.sessions.map((s) => [s.name, s.near, s.shared]), [
    ['near', true, false],
    ['far', false, false],
    ['twin', false, true],
    ['twin', false, true],
  ])
})

test('send relays the question, replies come back on the thread, follow-ups reuse it', async (t) => {
  const c = await setup(t)
  fakeClaude(t, c)
  const relay = () => JSON.parse(fs.readFileSync(path.join(path.dirname(c.root), 'relay.json'), 'utf8'))
  const r = await c.req('POST', '/api/send', { name: 'near', question: 'why?', selection: 'line one\nline two', file: '001-x/spec.md' })
  assert.equal(r.status, 200)
  const { thread } = r.data
  const { args, seen } = relay()
  assert.ok(args.includes('--no-session-persistence'))
  assert.equal(args[args.indexOf('--tools') + 1], 'SendMessage,ListAgents')
  assert.ok(args.includes('dontAsk'))
  assert.match(seen[0], /"near"/)
  assert.match(seen[0], /001-x\/spec\.md[\s\S]*> line one\n> line two[\s\S]*why\?[\s\S]*SendMessage/)

  let replies = []
  for (let i = 0; i < 50 && !replies.length; i++) {
    await new Promise((res) => setTimeout(res, 20))
    replies = (await c.req('GET', `/api/thread?id=${thread}&after=0`)).data.replies
  }
  assert.deepEqual(replies, ['answer 1\nsecond line'])

  const again = await c.req('POST', '/api/send', { thread, question: 'and?' })
  assert.equal(again.data.thread, thread)
  assert.equal(relay().seen.length, 2) // same relay process
  assert.equal((await c.req('GET', `/api/thread?id=${randomUUID()}&after=0`)).status, 404)
})

test('send rejects unknown, shared and undeliverable targets', async (t) => {
  const c = await setup(t)
  fakeClaude(t, c)
  assert.equal((await c.req('POST', '/api/send', { name: 'gone', question: 'q' })).status, 404)
  assert.equal((await c.req('POST', '/api/send', { name: 'twin', question: 'q' })).status, 409)
  assert.equal((await c.req('POST', '/api/send', { name: 'near', question: ' ' })).status, 400)
  const r = await c.req('POST', '/api/send', { name: 'near', question: 'FAILME' })
  assert.equal(r.status, 502)
  assert.match(r.data.error, /no such session/)
})
