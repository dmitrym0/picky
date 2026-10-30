import { marked } from '/vendor/marked.js'

const $ = (s) => document.querySelector(s)
const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props)
  el.append(...kids)
  return el
}
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
// show raw HTML in markdown as text: rendered HTML could run script against the local write API
marked.use({ renderer: { html: ({ text }) => esc(text) } })

let dir = { root: null, files: [] } // GET /api/dir body
let current = null // FileView of the open file
let editing = null // { index, text, error, conflict }
let dirty = false
let lastJump = null // section index we last jumped to; near the page bottom it can't scroll to the top

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body && JSON.stringify(body),
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

// resolves true when it is OK to leave the current edit
async function confirmLeave() {
  if (!dirty) return true
  const dlg = $('#unsaved')
  dlg.returnValue = 'stay'
  dlg.showModal()
  const choice = await new Promise((r) => dlg.addEventListener('close', () => r(dlg.returnValue), { once: true }))
  if (choice === 'save') return saveEdit()
  if (choice === 'discard') {
    editing = null
    dirty = false
    renderView()
    return true
  }
  return false
}

// ---- file list ----

async function refreshList() {
  dir = (await api('GET', '/api/dir')).data
  renderList()
}

// collapsed folders in the file list, per opened directory; a per-browser convenience, so storage may fail
const collapsedKey = () => `picky.collapsed:${dir.root}`
function loadCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(collapsedKey())) ?? [])
  } catch {
    return new Set()
  }
}
function saveCollapsed(set) {
  try {
    localStorage.setItem(collapsedKey(), JSON.stringify([...set]))
  } catch {}
}

// group by spec folder (first path segment), so its subfolders (checklists/, contracts/) list inside it
const specOf = (f) => (f.rel.includes('/') ? f.rel.slice(0, f.rel.indexOf('/')) : '')
const nameIn = (f) => f.rel.slice(specOf(f) ? specOf(f).length + 1 : 0)

function renderList() {
  const nav = $('#files')
  nav.replaceChildren()
  if (!dir.root) return nav.append(h('p', { className: 'hint', textContent: 'Open a directory to start.' }))
  if (!dir.files.length)
    return nav.append(h('p', { className: 'hint', textContent: `No markdown files found in ${dir.scanRoot}` }))
  const groups = Map.groupBy(dir.files, specOf)
  const folders = [...groups.keys()].sort()
  const collapsed = loadCollapsed()
  const setAll = (closed) => {
    saveCollapsed(new Set(closed ? folders : []))
    renderList()
  }
  nav.append(
    h(
      'div',
      { className: 'list-tools' },
      h('button', { textContent: 'Collapse all', onclick: () => setAll(true) }),
      h('button', { textContent: 'Expand all', onclick: () => setAll(false) }),
    ),
  )
  for (const folder of folders) {
    // the spec's own files first, then its subfolders
    const files = groups.get(folder).sort((a, b) => nameIn(a).includes('/') - nameIn(b).includes('/') || (nameIn(a) < nameIn(b) ? -1 : 1))
    const ul = h('ul')
    for (const f of files) {
      const btn = h(
        'button',
        { className: f.reviewed ? 'file reviewed' : 'file', value: f.path, onclick: () => openFile(f.path) },
        h('span', { className: 'name', textContent: nameIn(f) }),
        h('span', { className: 'count', textContent: `${f.reviewed ? '✓ ' : ''}${f.read}/${f.total}` }),
      )
      if (current?.path === f.path) btn.setAttribute('aria-current', 'true')
      ul.append(h('li', {}, btn))
    }
    const group = h(
      'details',
      { open: !collapsed.has(folder) },
      h('summary', {}, h('h3', { textContent: folder || 'Top level' }), progressBar(folder || 'Top level', files)),
      ul,
    )
    group.ontoggle = () => {
      const set = loadCollapsed()
      group.open ? set.delete(folder) : set.add(folder)
      saveCollapsed(set)
    }
    nav.append(group)
  }
}

function progressBar(name, files) {
  const read = files.reduce((n, f) => n + f.read, 0)
  const total = files.reduce((n, f) => n + f.total, 0)
  const pct = total ? Math.round((100 * read) / total) : 100
  const done = files.filter((f) => f.reviewed).length
  const title = [
    `${name}: ${read} of ${total} sections reviewed (${pct}%), ${done} of ${files.length} files done`,
    ...files.map((f) => `${f.reviewed ? '✓' : '·'} ${nameIn(f)}  ${f.read}/${f.total}`),
  ].join('\n')
  return h(
    'div',
    { className: 'bar', role: 'progressbar', ariaLabel: `${name} reviewed`, ariaValueNow: String(pct), ariaValueText: `${pct}%`, title },
    h('span', { style: `width: ${pct}%` }),
  )
}

// ---- file view ----

async function openFile(path) {
  if (!(await confirmLeave())) return
  await loadFile(path)
}

async function loadFile(path) {
  const r = await api('GET', `/api/file?path=${encodeURIComponent(path)}`)
  editing = null
  dirty = false
  lastJump = null
  current = r.status === 200 ? r.data : null
  renderView(r.status === 200 ? null : r.data.error)
  renderList()
}

function renderView(error) {
  const view = $('#view')
  view.replaceChildren()
  if (error) return view.append(h('p', { className: 'error', textContent: error }))
  if (!current) return view.append(h('p', { className: 'hint', textContent: dir.root ? 'Select a file.' : '' }))
  view.append(
    h(
      'div',
      { className: 'file-head' },
      h('h2', { textContent: current.rel }),
      h('span', { className: 'count', textContent: `${current.read}/${current.total} sections read` }),
      current.reviewed ? h('span', { className: 'badge', textContent: 'Reviewed' }) : '',
    ),
  )
  const frag = document.createDocumentFragment()
  for (const s of current.sections) frag.append(editing?.index === s.index ? renderEditor(s) : renderSection(s))
  view.append(frag)
}

function renderSection(s) {
  const body = h('div', { className: 'md', innerHTML: marked.parse(s.text) })
  // selecting text (to ask Claude about it) must not open the editor
  // block bodies: an on* handler that returns false cancels the event (would block links and typing)
  body.onclick = (e) => {
    if (!e.target.closest('a') && !getSelection().toString()) startEdit(s.index)
  }
  return h(
    'section',
    { className: `${s.read ? 'read' : 'unread'} ${s.kind}` },
    h(
      'div',
      { className: 'actions' },
      h('button', { textContent: 'Edit', onclick: () => startEdit(s.index) }),
      h('button', { textContent: 'Ask', onclick: () => openAsk(s.text.trim()) }),
      h('button', {
        className: 'toggle',
        textContent: s.kind === 'requirement' ? (s.read ? 'Confirmed ✓' : 'Confirm') : s.read ? 'Read ✓' : 'Mark read',
        ariaPressed: String(s.read),
        onclick: () => mark(s),
      }),
    ),
    body,
  )
}

async function mark(s) {
  const r = await api('POST', '/api/mark', { path: current.path, key: s.key, read: !s.read })
  if (r.status !== 200) return renderView(r.data.error)
  current = r.data
  renderView()
  refreshList()
}

// ---- next / previous unread ----

const sectionEls = () => [...$('#view').querySelectorAll(':scope > section')]
const unreadIn = () => (current ? current.sections.filter((s) => !s.read).map((s) => s.index) : [])
const headerBottom = () => $('header').getBoundingClientRect().bottom

// index of the section the reader is at: the one last jumped to while it's on screen, else the one at the top
function here() {
  const els = sectionEls()
  const last = els[lastJump]?.getBoundingClientRect()
  if (last && last.bottom > headerBottom() && last.top < innerHeight) return lastJump
  return els.findLastIndex((el) => el.getBoundingClientRect().top <= headerBottom() + 12)
}

let sayTimer
function say(msg) {
  $('#jump-status').textContent = msg
  clearTimeout(sayTimer)
  sayTimer = setTimeout(() => ($('#jump-status').textContent = ''), 2500)
}

async function jump(step) {
  const at = current ? here() : -1
  let target = step > 0 ? unreadIn().find((i) => i > at) : unreadIn().findLast((i) => i < at)
  if (target === undefined) {
    // none left this way in this file: go to the next/previous file in the list with unread sections
    const order = [...$('#files').querySelectorAll('.file')].map((b) => b.value)
    const pos = order.indexOf(current?.path)
    const unread = new Set(dir.files.filter((f) => f.read < f.total).map((f) => f.path))
    const file =
      step > 0
        ? order.slice(pos + 1).find((p) => unread.has(p))
        : (pos < 0 ? order : order.slice(0, pos)).findLast((p) => unread.has(p))
    if (!file) return say(step > 0 ? 'No unread sections below' : 'No unread sections above')
    await openFile(file)
    if (current?.path !== file) return // stayed to keep an unsaved edit, or the load failed
    target = step > 0 ? unreadIn()[0] : unreadIn().at(-1)
    if (target === undefined) return
  }
  lastJump = target
  const el = sectionEls()[target]
  scrollTo({ top: el.getBoundingClientRect().top + scrollY - headerBottom() - 8 })
  el.querySelector('.toggle')?.focus({ preventScroll: true })
}
$('#next-unread').onclick = () => jump(1)
$('#prev-unread').onclick = () => jump(-1)

// ---- editing ----

async function startEdit(index) {
  if (editing?.index === index) return
  if (!(await confirmLeave())) return
  editing = { index, text: current.sections[index].text }
  renderView()
  $('#view textarea').focus()
}

function renderEditor(s) {
  const ta = h('textarea', { value: editing.text, rows: editing.text.split('\n').length + 1, ariaLabel: 'Section markdown' })
  ta.oninput = () => {
    editing.text = ta.value
    dirty = true
  }
  return h(
    'section',
    { className: 'editing' },
    ta,
    h(
      'div',
      { className: 'actions' },
      h('button', { textContent: 'Save', onclick: saveEdit }),
      h('button', { textContent: 'Cancel', onclick: cancelEdit }),
      editing.conflict ? h('button', { textContent: 'Reload', onclick: () => loadFile(current.path) }) : '',
      h('span', { className: 'error', role: 'alert', textContent: editing.error ?? '' }),
    ),
  )
}

function cancelEdit() {
  editing = null
  dirty = false
  renderView()
}

async function saveEdit() {
  const s = current.sections[editing.index]
  const crlf = s.text.includes('\r\n')
  let text = editing.text.replace(/\r?\n/g, crlf ? '\r\n' : '\n') // textareas normalise to \n
  // keep the next heading on its own line
  if (s.index < current.sections.length - 1 && text && !text.endsWith('\n')) text += crlf ? '\r\n' : '\n'
  const r = await api('POST', '/api/save', { path: current.path, hash: current.hash, start: s.start, end: s.end, text })
  if (r.status === 200) {
    current = r.data
    editing = null
    dirty = false
    renderView()
    refreshList()
    return true
  }
  editing.conflict = r.status === 409
  editing.error = editing.conflict
    ? 'This file changed on disk. Copy your text, then Reload.'
    : r.data.error || `Save failed (${r.status})`
  renderView()
  return false
}

// ---- directory ----

$('#open').onsubmit = async (e) => {
  e.preventDefault()
  if (!(await confirmLeave())) return
  const r = await api('POST', '/api/dir', { path: $('#dir').value })
  $('#dir-error').textContent = r.status === 200 ? '' : r.data.error
  if (r.status !== 200) return
  dir = r.data
  $('#dir').value = dir.root
  current = editing = null
  renderList()
  renderView()
  $('#ask-session').replaceChildren() // sessions belong to the directory
  resetThread()
}

// ---- ask Claude about selected text ----

let quote = '' // selected text for the next question
let fork = null // session id of our copy of the chosen session; follow-ups continue it
let liveThread = null // relay thread for a live session; its replies are polled into the panel
let replyCount = 0
let pending = null // spinner bubble shown until the answer arrives
let poller = null

function showAskButton() {
  const sel = getSelection()
  const text = sel.toString().trim()
  const btn = $('#ask-btn')
  if (!text || !$('#view').contains(sel.anchorNode) || $('#view textarea')?.contains(sel.anchorNode)) return (btn.hidden = true)
  const r = sel.getRangeAt(0).getBoundingClientRect()
  Object.assign(btn.style, { top: `${r.bottom + scrollY + 6}px`, left: `${Math.max(8, r.left + scrollX)}px` })
  btn.hidden = false
  btn.onclick = () => openAsk(text)
}
document.addEventListener('mouseup', () => setTimeout(showAskButton))
document.addEventListener('keyup', (e) => e.shiftKey && showAskButton())
$('#ask-btn').onmousedown = (e) => e.preventDefault() // keep the selection while clicking

async function openAsk(text) {
  $('#ask-btn').hidden = true
  quote = text
  $('#ask-quote').textContent = text
  $('#ask-quote').hidden = false
  $('#ask').hidden = false
  $('#ask-q').focus()
  await loadSessions() // every time: live sessions come and go
}

// option values are `live:<session name>` or `copy:<saved session id>`
async function loadSessions() {
  const select = $('#ask-session')
  const keep = select.value
  const [live, saved] = await Promise.all([api('GET', '/api/live'), api('GET', '/api/sessions')])
  const liveList = live.data.sessions ?? []
  const savedList = saved.data.sessions ?? []
  const group = (label, options) => (options.length ? [h('optgroup', { label }, ...options)] : [])
  select.replaceChildren(
    ...group(
      'Live session · it answers here when its current turn ends',
      liveList.map((s) =>
        h('option', {
          value: `live:${s.name}`,
          disabled: s.shared,
          textContent: `${s.name} · ${s.status ?? ''}${s.near ? '' : ` · ${s.cwd}`}${s.shared ? ' · name shared, /rename one' : ''}`,
        }),
      ),
    ),
    ...group(
      'Copy of a saved session · answer appears here',
      savedList.map((s) => h('option', { value: `copy:${s.id}`, textContent: `${s.title} · ${new Date(s.mtime).toLocaleString()}` })),
    ),
  )
  if ([...select.options].some((o) => o.value === keep && !o.disabled)) select.value = keep
  $('#ask-status').textContent = !liveList.length && !savedList.length
    ? 'No Claude Code sessions found.'
    : live.status !== 200 ? `Live sessions unavailable: ${live.data.error}` : ''
}

function resetThread() {
  fork = liveThread = pending = null
  replyCount = 0
  clearInterval(poller)
  $('#ask-thread').replaceChildren()
}

async function pollReplies() {
  const id = liveThread
  const r = await api('GET', `/api/thread?id=${id}&after=${replyCount}`)
  if (id !== liveThread) return // thread was reset while we waited
  if (r.status !== 200) return clearInterval(poller)
  if (r.data.replies.length) setPending()
  for (const reply of r.data.replies) addMessage('claude', reply)
  replyCount += r.data.replies.length
  if (r.data.closed) {
    clearInterval(poller)
    setPending()
    addMessage('note', 'The relay for this thread has stopped. Start a new thread to ask again.')
    liveThread = null
  }
}

function addMessage(who, md, q) {
  const msg = h('div', { className: `msg ${who}` })
  if (q) msg.append(h('blockquote', { textContent: q }))
  msg.append(h('div', { className: 'md', innerHTML: marked.parse(md) }))
  $('#ask-thread').append(msg)
  msg.scrollIntoView({ block: 'end' })
  return msg
}

function setPending(text) {
  pending?.remove()
  pending = text ? h('div', { className: 'msg pending', role: 'status', textContent: text }) : null
  if (pending) {
    $('#ask-thread').append(pending)
    pending.scrollIntoView({ block: 'end' })
  }
}

$('#ask-form').onsubmit = async (e) => {
  e.preventDefault()
  const question = $('#ask-q').value.trim()
  const choice = fork ? `copy:${fork}` : $('#ask-session').value
  const live = choice.startsWith('live:')
  const target = choice.slice(choice.indexOf(':') + 1)
  if (!question || !target) return
  const btn = $('#ask-form button')
  btn.disabled = true
  $('#ask-status').textContent = ''
  const mine = addMessage('you', question, quote)
  setPending(live ? `Sending to ${target}…` : 'Asking Claude… this can take a minute.')
  const body = { question, selection: quote, file: current?.rel }
  const r = live
    ? await api('POST', '/api/send', { name: target, thread: liveThread, ...body })
    : await api('POST', '/api/ask', { session: target, ...body })
  btn.disabled = false
  if (r.status !== 200) {
    mine.remove()
    setPending()
    return ($('#ask-status').textContent = r.data.error || `Failed (${r.status})`) // question stays in the box
  }
  if (live) {
    liveThread = r.data.thread
    clearInterval(poller)
    poller = setInterval(pollReplies, 2000)
  } else {
    setPending()
    addMessage('claude', r.data.answer)
    fork = r.data.session
  }
  quote = ''
  $('#ask-quote').hidden = true
  $('#ask-q').value = ''
  if (live) setPending(`Sent. Waiting for ${target} to answer…`)
}
$('#ask-q').onkeydown = (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#ask-form').requestSubmit()
}
$('#ask-session').onchange = resetThread
$('#ask-new').onclick = resetThread
$('#ask-close').onclick = () => ($('#ask').hidden = true)

window.addEventListener('focus', async () => {
  await refreshList()
  if (current && !dirty) loadFile(current.path) // pick up outside changes, never over an unsaved edit
})
window.addEventListener('beforeunload', (e) => dirty && e.preventDefault())

await refreshList()
$('#dir').value = dir.root ?? ''
renderView()
