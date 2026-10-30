import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let file
let data = {}

export function load() {
  file = process.env.PICKY_STORE || path.join(os.homedir(), '.picky', 'reviews.json')
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object')
  } catch (e) {
    data = {}
    if (e.code === 'ENOENT') return
    // keep the unreadable file instead of silently overwriting someone's progress
    const bad = `${file}.bad-${Date.now()}`
    try {
      fs.renameSync(file, bad)
      console.error(`Review store was unreadable (${e.message}); moved to ${bad}`)
    } catch {}
  }
}

export const getRead = (p) => new Set(Array.isArray(data[p]) ? data[p] : [])

export function setRead(p, keys) {
  const list = [...keys]
  if (list.length) data[p] = list
  else delete data[p]
  save()
}

export function drop(p) {
  if (!(p in data)) return
  delete data[p]
  save()
}

function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1))
  fs.renameSync(tmp, file)
}
