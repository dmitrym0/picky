import http from 'node:http'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitSections, hash } from './sections.js'
import * as store from './store.js'

const pub = (f) => fileURLToPath(new URL(`../public/${f}`, import.meta.url))
const JS = 'text/javascript; charset=utf-8'
const STATIC = {
  '/': [pub('index.html'), 'text/html; charset=utf-8'],
  '/app.js': [pub('app.js'), JS],
  '/style.css': [pub('style.css'), 'text/css; charset=utf-8'],
  '/vendor/marked.js': [fileURLToPath(import.meta.resolve('marked')), JS],
}
// raw HTML in markdown is escaped client-side; CSP is the backstop against script reaching the write API
const CSP = "default-src 'self'; img-src 'self' data: https:; style-src 'self'"

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message)
    Object.assign(this, { status, extra })
  }
}

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const JSON_STR = '"((?:[^"\\\\]|\\\\.)*)"'

// title and cwd of one Claude Code session file, without parsing every line of a possibly huge log
function sessionInfo(file, mtime) {
  const text = fs.readFileSync(file, 'utf8')
  const last = (field) => {
    let v
    for (const m of text.matchAll(new RegExp(`"${field}":${JSON_STR}`, 'g'))) v = m[1]
    return v === undefined ? undefined : JSON.parse(`"${v}"`)
  }
  const cwd = text.match(new RegExp(`"cwd":${JSON_STR}`))
  if (!cwd) return null
  const prompt = text.match(new RegExp(`"role":"user","content":${JSON_STR}`)) // -p sessions get no title
  const fallback = prompt ? JSON.parse(`"${prompt[1]}"`).trim().slice(0, 80) : '(untitled)'
  return { id: path.basename(file, '.jsonl'), title: last('customTitle') ?? last('aiTitle') ?? fallback, cwd: JSON.parse(`"${cwd[1]}"`), mtime }
}

// shortcut: assumes Claude Code names project folders by replacing every non-alphanumeric character with '-'; revisit if sessions stop showing up
function listSessions(root) {
  const projects = path.join(os.homedir(), '.claude', 'projects')
  for (let d = root; d !== os.homedir() && d !== path.dirname(d); d = path.dirname(d)) {
    const dir = path.join(projects, d.replace(/[^a-zA-Z0-9]/g, '-'))
    let files
    try {
      files = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'))
    } catch {
      continue
    }
    if (!files.length) continue
    return files
      .map((n) => ({ file: path.join(dir, n), mtime: fs.statSync(path.join(dir, n)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 30)
      .map((f) => sessionInfo(f.file, f.mtime))
      .filter(Boolean)
  }
  return []
}

function run(cmd, args, cwd, input) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE // let it start even when Picky itself was launched from a Claude Code terminal
    const p = spawn(cmd, args, { cwd, env, timeout: 10 * 60_000 })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => (stdout += d))
    p.stderr.on('data', (d) => (stderr += d))
    p.on('error', (e) => reject(new HttpError(502, e.code === 'ENOENT' ? `Could not run ${cmd} in ${cwd}` : e.message)))
    p.on('close', (code) => resolve({ code, stdout, stderr }))
    p.stdin.end(input)
  })
}

// runs claude and returns its parsed JSON output
async function claude(args, cwd, input) {
  const { code, stdout, stderr } = await run(process.env.PICKY_CLAUDE || 'claude', args, cwd, input)
  try {
    return JSON.parse(stdout)
  } catch {
    throw new HttpError(502, stderr.trim() || stdout.trim() || `claude exited with code ${code}`)
  }
}

function walk(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p)
  }
  return out
}

export function start({ port = 4321, dir } = {}) {
  store.load()
  const state = { root: null, scanRoot: null }

  function openDir(p) {
    if (typeof p !== 'string' || !p.trim()) throw new HttpError(400, 'Enter a directory path')
    const want = p.trim().replace(/^~(?=$|\/)/, os.homedir())
    let root
    try {
      root = fs.realpathSync(path.resolve(want))
      if (!fs.statSync(root).isDirectory()) throw new Error()
      fs.accessSync(root, fs.constants.R_OK)
    } catch {
      throw new HttpError(400, `Not a readable directory: ${p}`)
    }
    const specs = path.join(root, 'specs')
    Object.assign(state, { root, scanRoot: isDir(specs) ? specs : root })
  }

  function guard(p) {
    if (!state.scanRoot) throw new HttpError(400, 'No directory is open')
    if (typeof p !== 'string' || !p) throw new HttpError(400, 'Missing path')
    const inside = (x) => x.endsWith('.md') && x.startsWith(state.scanRoot + path.sep)
    const abs = path.resolve(p)
    if (!inside(abs)) throw new HttpError(403, 'Not a markdown file in the open directory')
    let real
    try {
      real = fs.realpathSync(abs)
    } catch {
      store.drop(abs)
      throw new HttpError(404, 'File not found')
    }
    if (!inside(real)) throw new HttpError(403, 'Not a markdown file in the open directory')
    return real
  }

  function fileView(p) {
    const text = fs.readFileSync(p, 'utf8')
    const sections = splitSections(text)
    const keys = new Set(sections.map((s) => s.key))
    const stored = store.getRead(p)
    const read = new Set([...stored].filter((k) => keys.has(k)))
    if (read.size !== stored.size) store.setRead(p, read)
    const total = sections.length
    return {
      path: p,
      rel: path.relative(state.scanRoot, p),
      hash: hash(text),
      sections: sections.map((s) => ({ ...s, read: read.has(s.key) })),
      read: read.size,
      total,
      reviewed: total > 0 && read.size === total,
    }
  }

  function dirBody() {
    if (!state.root) return { root: null, scanRoot: null, files: [] }
    const files = walk(state.scanRoot)
      .map((p) => {
        const { sections, hash: _, ...entry } = fileView(p)
        const folder = path.dirname(entry.rel)
        return { ...entry, folder: folder === '.' ? '' : folder }
      })
      .sort((a, b) => (a.rel < b.rel ? -1 : 1))
    return { root: state.root, scanRoot: state.scanRoot, files }
  }

  const forks = new Map() // session id we created -> cwd

  async function ask({ session, question, selection, file }) {
    if (typeof session !== 'string' || !UUID.test(session)) throw new HttpError(400, 'Invalid session id')
    if (typeof question !== 'string' || !question.trim()) throw new HttpError(400, 'Type a question')
    const own = forks.has(session)
    const cwd = own ? forks.get(session) : listSessions(state.root ?? '/').find((s) => s.id === session)?.cwd
    if (!cwd) throw new HttpError(404, 'Session not found')
    const prompt =
      (typeof selection === 'string' && selection.trim()
        ? `I'm reviewing ${typeof file === 'string' ? file : 'a file'} in Picky. About this passage:\n\n<selection>\n${selection}\n</selection>\n\n`
        : '') + question
    // never continue the user's own session: fork it once, then follow-ups continue our fork; plan mode keeps it read-only
    const args = ['-p', '--resume', session, ...(own ? [] : ['--fork-session'])]
    args.push('--permission-mode', 'plan', '--permission-prompts', 'none', '--output-format', 'json')
    const out = await claude(args, cwd, prompt)
    if (out.is_error) throw new HttpError(502, out.result || 'Claude returned an error')
    forks.set(out.session_id, cwd)
    return { session: out.session_id, answer: out.result }
  }

  // running Claude Code sessions; ones working in or around the opened directory first
  async function liveSessions() {
    const list = await claude(['agents', '--json'], os.tmpdir())
    if (!Array.isArray(list)) throw new HttpError(502, 'Unexpected output from claude agents')
    const counts = new Map()
    for (const a of list) counts.set(a.name, (counts.get(a.name) ?? 0) + 1)
    const near = (cwd) => !!state.root && (state.root === cwd || state.root.startsWith(cwd + path.sep) || cwd.startsWith(state.root + path.sep))
    return list
      .filter((a) => typeof a.name === 'string' && typeof a.cwd === 'string')
      .map((a) => ({ name: a.name, cwd: a.cwd, status: a.status, startedAt: a.startedAt, near: near(a.cwd), shared: counts.get(a.name) > 1 }))
      .sort((a, b) => b.near - a.near || b.startedAt - a.startedAt)
  }

  // Only Claude sessions can message each other, so a long-lived Haiku "relay" sends questions into a
  // running session and stays up to receive its replies, echoing each one on stdout for Picky to show.
  const threads = new Map() // thread id -> relay
  const RELAY_RULES = [
    "You are a message relay for Picky, the user's spec review app. You only ever do these two things:",
    '1. When asked to send text, send exactly the text between the two marker lines with SendMessage to the named session, then reply with exactly SENT, or FAILED: <reason>. If more than one session has that name, do not send.',
    '2. When a message from another Claude session arrives, do not answer it and do not call any tool: output exactly REPLY: followed by the full text of that message, copied verbatim.',
  ].join('\n')

  function startRelay(name) {
    const tools = 'SendMessage,ListAgents' // no file, shell or web tools
    const args = ['-p', '--model', 'haiku', '--no-session-persistence', '--tools', tools, '--allowedTools', tools]
    args.push('--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--append-system-prompt', RELAY_RULES)
    args.push('--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose')
    const env = { ...process.env }
    delete env.CLAUDECODE
    const proc = spawn(process.env.PICKY_CLAUDE || 'claude', args, { cwd: os.tmpdir(), env })
    const t = { id: randomUUID(), name, proc, replies: [], acks: [], closed: false, timer: null, buf: '' }
    const finish = (why) => {
      t.closed = true
      for (const ack of t.acks.splice(0)) ack(`FAILED: ${why}`)
    }
    proc.on('error', (e) => finish(e.code === 'ENOENT' ? 'could not run claude' : e.message))
    proc.on('close', () => finish('relay exited'))
    proc.stdin.on('error', () => {}) // relay died mid-write; 'close' reports it
    proc.stdout.on('data', (d) => {
      t.buf += d
      for (let i; (i = t.buf.indexOf('\n')) >= 0; t.buf = t.buf.slice(i + 1)) {
        let o
        try {
          o = JSON.parse(t.buf.slice(0, i))
        } catch {
          continue
        }
        if (o.type !== 'result') continue
        // a turn's result is a send ack (SENT / FAILED), a REPLY, or both when a reply lands mid-send
        const text = String(o.result ?? '')
        const at = text.indexOf('REPLY:')
        const ack = (at < 0 ? text : text.slice(0, at)).trim()
        if (ack) t.acks.shift()?.(o.is_error ? `FAILED: ${ack}` : ack)
        // shortcut: the reply reaches us as Haiku's verbatim copy, since stream-json doesn't emit incoming messages; very long answers could be altered
        if (at >= 0) t.replies.push(text.slice(at + 'REPLY:'.length).trim())
      }
    })
    threads.set(t.id, t)
    return t
  }

  function relaySend(t, message) {
    clearTimeout(t.timer)
    t.timer = setTimeout(() => t.proc.stdin.end(), 30 * 60_000).unref() // idle relays shut down
    const marker = `---${randomUUID()}---` // unguessable, so the message can't end the instructions early
    const content = `Send the text between the two ${marker} lines to the session named ${JSON.stringify(t.name)}.\n${marker}\n${message}\n${marker}`
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve('FAILED: relay did not answer in time'), 2 * 60_000).unref()
      t.acks.push((ack) => {
        clearTimeout(timeout)
        resolve(ack)
      })
      t.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n')
    })
  }

  async function send({ name, thread, question, selection, file }) {
    if (typeof question !== 'string' || !question.trim()) throw new HttpError(400, 'Type a question')
    let t = threads.get(thread)
    if (!t || t.closed) {
      if (typeof name !== 'string' || !name) throw new HttpError(400, 'Pick a session')
      const target = (await liveSessions()).find((s) => s.name === name)
      if (!target) throw new HttpError(404, `No running session named "${name}"`)
      // shortcut: sessions sharing a name can't be addressed (agents --json has no ref to disambiguate); user renames one
      if (target.shared) throw new HttpError(409, `Several sessions are named "${name}"; give one a unique name with /rename`)
      t = startRelay(name)
    }
    const about = typeof selection === 'string' && selection.trim()
      ? ` about ${typeof file === 'string' ? file : 'a file'}:\n\n> ${selection.trim().replace(/\n/g, '\n> ')}\n\n`
      : ':\n\n'
    const reply = '\n\n(Reply with SendMessage to the sender of this message. Your reply is shown to the user in Picky.)'
    const ack = await relaySend(t, `Question from Picky, the user's spec review app${about}${question.trim()}${reply}`)
    if (ack !== 'SENT') {
      if (!t.replies.length) t.proc.stdin.end() // a relay that never delivered anything is not worth keeping
      throw new HttpError(502, `Could not deliver: ${ack}`)
    }
    return { thread: t.id }
  }

  function threadReplies(url) {
    const t = threads.get(url.searchParams.get('id'))
    if (!t) throw new HttpError(404, 'Thread not found')
    return { replies: t.replies.slice(Number(url.searchParams.get('after')) || 0), closed: t.closed }
  }

  function save({ path: p, hash: h, start, end, text }) {
    p = guard(p)
    const buf = fs.readFileSync(p)
    const cur = buf.toString('utf8')
    if (hash(cur) !== h) throw new HttpError(409, 'changed on disk', { view: fileView(p) })
    if (!Buffer.from(cur).equals(buf)) throw new HttpError(400, 'File is not valid UTF-8; edit it in another editor')
    if (typeof text !== 'string') throw new HttpError(400, 'Missing text')
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end > cur.length)
      throw new HttpError(400, 'Invalid section range')
    const next = cur.slice(0, start) + text + cur.slice(end)
    try {
      fs.writeFileSync(p, next)
    } catch (e) {
      throw new HttpError(500, `Could not save: ${e.message}`)
    }
    // the reviewer just wrote these sections, so they count as read
    const read = store.getRead(p)
    const editEnd = start + text.length
    for (const s of splitSections(next)) if (s.start < editEnd && s.end > start) read.add(s.key)
    store.setRead(p, read)
    return fileView(p)
  }

  const routes = {
    'GET /api/dir': () => dirBody(),
    'POST /api/dir': (b) => {
      openDir(b.path)
      return dirBody()
    },
    'GET /api/file': (_, url) => fileView(guard(url.searchParams.get('path'))),
    'POST /api/mark': (b) => {
      const p = guard(b.path)
      if (typeof b.key !== 'string' || typeof b.read !== 'boolean') throw new HttpError(400, 'Need key and read')
      const read = store.getRead(p)
      b.read ? read.add(b.key) : read.delete(b.key)
      store.setRead(p, read)
      return fileView(p)
    },
    'POST /api/save': (b) => save(b),
    'GET /api/sessions': () => ({ sessions: state.root ? listSessions(state.root) : [] }),
    'GET /api/live': async () => ({ sessions: await liveSessions() }),
    'POST /api/send': (b) => send(b),
    'GET /api/thread': (_, url) => threadReplies(url),
    'POST /api/ask': (b) => ask(b),
  }

  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP })
      res.end(type.startsWith('application/json') ? JSON.stringify(body) : body)
    }
    try {
      const { port } = server.address()
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) throw new HttpError(403, 'Bad Host header')
      const url = new URL(req.url, `http://${req.headers.host}`)

      const file = req.method === 'GET' && STATIC[url.pathname]
      if (file) return send(200, fs.readFileSync(file[0]), file[1])

      const route = routes[`${req.method} ${url.pathname}`]
      if (!route) throw new HttpError(404, 'Not found')
      let body = {}
      if (req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Use application/json')
        let raw = ''
        for await (const chunk of req) raw += chunk
        try {
          body = JSON.parse(raw) ?? {}
        } catch {
          throw new HttpError(400, 'Invalid JSON')
        }
      }
      send(200, await route(body, url))
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e)
      send(e.status ?? 500, { error: e.message, ...e.extra })
    }
  })

  server.on('close', () => threads.forEach((t) => t.proc.kill()))
  if (dir) openDir(dir)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4321)
  start({ port, dir: process.argv[2] })
    .then((s) => console.log(`Picky: http://127.0.0.1:${s.address().port}`))
    .catch((e) => {
      console.error(e.code === 'EADDRINUSE' ? `Port ${port} is in use; set PORT to another port` : e.message)
      process.exit(1)
    })
}
