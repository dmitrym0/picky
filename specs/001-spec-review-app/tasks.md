---

description: "Task list for Spec Review App"
---

# Tasks: Spec Review App

**Input**: Design documents from `/specs/001-spec-review-app/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Included, because plan.md (R10) calls for `node:test` unit and integration tests. Test tasks come before the code they cover and should fail first.

**Organization**: Grouped by user story. US1 = review and roll-up, US2 = edit in place, US3 = open directories and see progress across files.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

Single package at the repository root: `src/` (server), `public/` (static page), `test/`. Contract: [contracts/api.md](./contracts/api.md). Data rules: [data-model.md](./data-model.md).

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Create `package.json` at the repo root: `"name": "picky"`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=22" }`, scripts `"start": "node src/server.js"` and `"test": "node --test test/"`, one dependency `marked` (current major). Run `npm install` so `node_modules/marked/lib/marked.esm.js` exists.
- [X] T002 [P] Create `.gitignore` at the repo root containing `node_modules/`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Section scanner, review store, and a server that can open a directory and serve the page. Every story depends on these.

- [X] T003 [P] Write unit tests in `test/sections.test.js` for `splitSections(text)` from `src/sections.js`:
  - Round-trip: `sections.map(s => s.text).join("") === text`, for several inputs including CRLF line endings and a file with no trailing newline.
  - Preamble: text before the first heading becomes section 0 with `level: 0` and `heading: ""`. It's left out when empty.
  - A file with no headings is 1 section. An empty string gives `[]`.
  - Headings `#` through `######` give levels 1–6 and the heading text without the `#`s. Up to 3 leading spaces are allowed.
  - Not headings: `#hashtag`, 4-space-indented `# x`, `####### x`.
  - Fences: `# x` inside a ```` ``` ```` fence and inside a `~~~` fence doesn't split. A fence opened with 4 backticks isn't closed by 3. A `~~~` line doesn't close a backtick fence.
  - Duplicate keys: two sections with identical text get keys ending `#0` and `#1`. The part before `#` is the sha256 hex of the text.
  - Offsets: `start` and `end` satisfy `text.slice(start, end) === section.text`, and the sections are contiguous.
- [X] T004 [P] Implement `src/sections.js`. Export `hash(str)` (sha256 hex via `node:crypto`) and `splitSections(text)`, which returns `[{ index, heading, level, start, end, text, key }]`. Follow these rules from data-model.md verbatim:
  - "A new section starts at a line matching `^ {0,3}#{1,6}(\s|$)` that is not inside a fenced code block".
  - "A fence opens at `^ {0,3}(`{3,}|~{3,})` and closes at a line holding a run of the same character at least as long".
  - The preamble is "omitted when empty".
  - "Invariant: `sections.map(s => s.text).join("") === fileText`".
  - Key = `hash(text) + "#" + n`, where n counts earlier sections with identical text.
  - Add the comment `// shortcut: setext headings (=== / ---) are not split, upgrade if real files use them`.
  - Make T003 pass.
- [X] T005 [P] Implement `src/store.js`:
  - The store path is `process.env.PICKY_STORE || ~/.picky/reviews.json`.
  - `load()` reads the JSON into an in-memory object. A missing file gives `{}`. Unparseable JSON is renamed to `reviews.json.bad-<Date.now()>`, then `{}` is used.
  - Export `getRead(path) -> Set<string>`, `setRead(path, keysIterable)`, and `drop(path)`. A key set that becomes empty deletes that path's entry.
  - Every change calls `save()`. `save()` creates the folder (`mkdir -p`), writes `reviews.json.tmp-<pid>`, then `fs.renameSync`s it over `reviews.json` (an atomic write).
  - Use sync fs calls, so concurrent requests can't interleave writes.
- [X] T006 Implement the server skeleton in `src/server.js`. Export `start({ port, dir }) -> Promise<http.Server>`, and only run main when `process.argv[1] === fileURLToPath(import.meta.url)`. It must:
  - Bind to `127.0.0.1`. The port is `PORT` env or 4321; port 0 is allowed for tests. Print `Picky: http://127.0.0.1:<port>`. Exit with a clear message on `EADDRINUSE`.
  - Answer `403 { error }` unless the `Host` header is `127.0.0.1:<port>` or `localhost:<port>`.
  - Answer `415` for a `POST` without `Content-Type: application/json`, and `400` when the JSON body can't be parsed.
  - Send all errors as `{ "error": msg }`, and wrap every handler so an unexpected exception returns 500.
  - Serve static files: `/` → `public/index.html`, plus `/app.js` and `/style.css` from `public/`. `/vendor/marked.js` → `node_modules/marked/lib/marked.esm.js`. Use correct `Content-Type`s and 404 for anything else.
  - Implement `openDir(p)`: expand a leading `~` to `os.homedir()`, `fs.realpathSync`, and require `statSync(...).isDirectory()` plus `fs.accessSync(R_OK)`. Throw with a readable message otherwise. Set `state.root`, and set `state.scanRoot` to `root/specs` if that is a directory, otherwise `root`.
  - Implement `listFiles()`: `fs.readdirSync(scanRoot, { recursive: true })`. Keep `*.md` files whose relative path has no segment starting with `.` and no `node_modules` segment. Return `[{ path: realpath, rel, folder: path.dirname(rel) === "." ? "" : path.dirname(rel) }]` sorted by `rel`.
  - Implement `guard(p)`: `realpath` it, then require it to end in `.md` and sit inside `state.scanRoot + path.sep`. Answer 403 if it doesn't, and 404 if the file is missing (also calling `store.drop(p)`).
  - Route `GET /api/dir` → `{ root, scanRoot, files }`. Before any directory is opened, return `root: null, files: []`.
  - Open the directory from the CLI argument (`process.argv[2]`) at startup when one is given.
- [X] T007 Create the page shell:
  - `public/index.html`: a header holding the current directory path, an `<aside id="files">` list, a `<main id="view">`, and a `<dialog id="unsaved">` with Save, Discard and Stay buttons. It loads `style.css` and `<script type="module" src="/app.js">`.
  - `public/style.css`: a two-column layout (sidebar plus main), readable markdown typography, and `max-width` on the main column.
  - `public/app.js`: on load, `GET /api/dir`, list each file's `rel` in `#files`, and call `openFile(path)` on click (a stub until US1).
  - Add a `api(method, url, body)` helper that sends JSON with `Content-Type: application/json` and returns `{ status, data }`.

**Checkpoint**: `npm start -- <dir>` serves the page and lists that directory's markdown files. `npm test` passes `sections.test.js`.

---

## Phase 3: User Story 1 - Review a spec file section by section (Priority: P1) 🎯 MVP

**Goal**: Open a file, see it split into sections, mark each one read or unread, and see the file's count, with progress kept between runs and outside changes resetting only the sections that changed.

**Independent Test**: Open a directory holding one file with 6 sections and mark 4 read. The file shows 4/6. Restart the server; still 4/6. Mark the last 2; the file shows as reviewed, in the list too.

### Tests for User Story 1

- [X] T008 [P] [US1] Create `test/server.test.js`. Each test makes a temp dir with `fs.mkdtempSync`, sets `process.env.PICKY_STORE` to a file inside it, writes fixture `.md` files, calls `start({ port: 0, dir })`, and uses `fetch` against `http://127.0.0.1:<port>`. Close the server in `after`. Cover:
  - `GET /api/file` returns every section unread, with `read: 0` and `reviewed: false`.
  - `POST /api/mark` with `read: true` raises `read` by 1. `read: false` lowers it again.
  - Marking every section read gives `reviewed: true`. `GET /api/dir` shows that file with `read === total` and `reviewed: true`.
  - Persistence: close the server, `start` it again with the same `PICKY_STORE`, and the same sections are read.
  - Outside change: mark all sections read, rewrite one section's text with `fs.writeFileSync`, then `GET /api/file`. Only that section is unread, and its old key is pruned from the store file.
  - A deleted file returns 404 and its entry is removed from the store file.
  - 403 for a `.txt` file and for a `.md` path outside `scanRoot`.
  - 403 for a `Host: evil.com` request. Use `http.request`, because `fetch` can't set `Host`.
  - 415 for a `POST /api/mark` with `Content-Type: text/plain`.

### Implementation for User Story 1

- [X] T009 [US1] In `src/server.js`, add `fileView(path)`. It reads the file (utf8), runs `splitSections`, and intersects `store.getRead(path)` with the current keys. When that removes stale keys, it calls `store.setRead` to prune them. It returns `{ path, hash: hash(text), sections: [...each with read: bool], read, total, reviewed: total > 0 && read === total }`. Route `GET /api/file?path=` → `guard` then `fileView`.
- [X] T010 [US1] In `src/server.js`, route `POST /api/mark` with body `{ path, key, read }`. Run `guard`, add the key to (or remove it from) `store.getRead(path)`, call `store.setRead`, and return `fileView(path)`. Answer 400 if `key` isn't a string or `read` isn't a boolean.
- [X] T011 [US1] In `src/server.js`, give every entry returned by `GET /api/dir` the `read`, `total` and `reviewed` fields from `fileView` (reuse it, then drop the `sections`).
- [X] T012 [US1] In `public/app.js`, implement `openFile(path)` and `renderView(view)`:
  - Import `marked` from `/vendor/marked.js`. Call `marked.use({ renderer: { html: ({ text }) => escapeHtml(text) } })` so raw HTML in markdown is shown as text, never run (R8).
  - For each section, render `<section data-index>` holding `marked.parse(section.text)` and a "Mark read" / "Read ✓" toggle button that calls `POST /api/mark` and re-renders from the returned view.
  - Put a file header above the sections showing `rel`, `read/total`, and a "Reviewed" badge when `reviewed` is true.
  - Keep the current view in a module-level `current`.
- [X] T013 [US1] In `public/app.js`, show each file in `#files` as `rel  read/total`, with a "✓" when it's reviewed and the open file highlighted. After every mark, re-fetch `GET /api/dir` and re-render the list.
- [X] T014 [P] [US1] In `public/style.css`, style unread sections with a strong left border and full contrast, and read sections with a muted border plus a ✓ state. Style the Reviewed badge and the sidebar counts. The toggle button must be keyboard-focusable with a visible focus ring.

**Checkpoint**: US1 works on its own. `npm test` passes, and quickstart scenarios 2–4 pass.

---

## Phase 4: User Story 2 - Edit a section in place (Priority: P2)

**Goal**: Click a section, edit its raw markdown, and save. Only that slice of the file changes on disk, and no edit is ever lost.

**Independent Test**: Click a section, change one sentence, and save. `git diff` (or `diff`) shows only that sentence changed, and the section is marked read.

### Tests for User Story 2

- [X] T015 [P] [US2] Add `POST /api/save` tests to `test/server.test.js`:
  - A byte-exact splice: the file afterwards equals `before.slice(0,start) + text + before.slice(end)`, compared with `Buffer.equals`.
  - The edited section is read in the returned view.
  - An edit that adds a new `## Heading` gives 2 sections, both read. Untouched sections keep their state.
  - A stale `hash` returns 409 with `view`, and the file on disk is unchanged.
  - 400 for `start > end`, for `end > length`, and for non-integer offsets.
  - Make the file read-only with `fs.chmodSync(f, 0o444)` (skip when running as root): 500, and the store file is unchanged.

### Implementation for User Story 2

- [X] T016 [US2] In `src/server.js`, route `POST /api/save` with body `{ path, hash, start, end, text }`:
  - Run `guard`, then re-read the file.
  - If `hash(current) !== body.hash`, return `409 { error: "changed on disk", view: fileView(path) }` and write nothing.
  - Validate `Number.isInteger(start) && Number.isInteger(end) && 0 <= start && start <= end && end <= current.length`, otherwise return 400.
  - Write `current.slice(0,start) + text + current.slice(end)` with `fs.writeFileSync`. A write error returns 500 with the error message and leaves the store untouched.
  - Then re-split, and add to the store the keys of every section that overlaps `[start, start + text.length)`. Return `fileView(path)`.
- [X] T017 [US2] In `public/app.js`, add section editing:
  - Clicking a section's body (not its toggle) replaces it with a `<textarea>` holding the raw `section.text`, sized to its content, with Save and Cancel buttons. Only one section can be edited at a time.
  - On Save: if the section isn't the last one and the text doesn't end in `\n`, add `\n`. Send `POST /api/save` with `current.hash`, `section.start`, `section.end` and the text.
  - On 200, re-render from the returned view and refresh the list.
  - On 409, keep the textarea and the user's text and show "This file changed on disk. Copy your text, then Reload." with a Reload button that re-opens the file.
  - On 500 or another error, keep the textarea and show the error message.
  - Cancel restores the rendered section without any request.
- [X] T018 [US2] In `public/app.js`, add the unsaved-edit guard. Set `dirty = true` on textarea `input`. Before opening another section, opening a file, or opening a directory while dirty, show `#unsaved` with `showModal()`:
  - Save runs the save path, then continues only if the save succeeded.
  - Discard drops the edit and continues.
  - Stay closes the dialog.
  
  Add a `beforeunload` listener that calls `e.preventDefault()` when dirty.
- [X] T019 [P] [US2] In `public/style.css`, style the editor: a monospace textarea at full width, and buttons with an error message area under it. Show `cursor: pointer` and a hover outline on sections that can be edited.

**Checkpoint**: US1 and US2 both work. Quickstart scenarios 5–6 pass.

---

## Phase 5: User Story 3 - Open a directory and see review progress across its files (Priority: P3)

**Goal**: Open any directory from the page, switch between directories, see files grouped by folder with progress, and see outside changes when returning to the window.

**Independent Test**: Open a directory with 3 feature folders and partly review 2 files. The list shows correct grouped progress. Open another directory, then reopen the first; the progress is unchanged.

### Tests for User Story 3

- [X] T020 [P] [US3] Add tests to `test/server.test.js`:
  - A root with `specs/` lists only files under `specs/`. A file in `.specify/` or `node_modules/` is never listed.
  - The `folder` field is correct for nested `001-x/checklists/requirements.md`.
  - `POST /api/dir` with a missing path returns 400, and `GET /api/dir` still returns the previous root.
  - `POST /api/dir` with a `~/...` path is expanded to the home folder. Use a path under the temp dir via `os.homedir`, or a mocked `HOME` env set before `start`.
  - The same file opened through the project root and then through its feature folder shows the same `read` count.
  - An empty directory returns `files: []`.

### Implementation for User Story 3

- [X] T021 [US3] In `src/server.js`, route `POST /api/dir` with body `{ path }`. Call `openDir(path)` and return the `GET /api/dir` body. On error, return 400 with the message and leave the state unchanged (`openDir` must only set state after every check passes).
- [X] T022 [US3] In `public/app.js` and `public/index.html`:
  - Add a path `<input>` with an Open button in the header. Enter also submits. It calls `POST /api/dir` behind the unsaved-edit guard from T018 and shows a 400 error inline next to the field.
  - Group `#files` by `folder` under folder headings, with top-level files first.
  - When `files` is empty, show "No markdown files found in <root>".
  - When no directory is open, show "Open a directory to start".
- [X] T023 [US3] In `public/app.js`, add a `window` `focus` listener. It always re-fetches `GET /api/dir`, and re-fetches the open file only when not `dirty`, so an open editor is never replaced.

**Checkpoint**: All three stories work. Quickstart scenario 1 passes.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T024 Generate a 500-section markdown file in a temp dir and confirm the view is usable in under 2 seconds (SC-007). If it's slower, render sections into a `DocumentFragment` before inserting them in `public/app.js`.
- [X] T025 Run `npm test` and walk through every scenario in `specs/001-spec-review-app/quickstart.md` (1–8). Fix any failures in the file responsible.

---

## Phase 7: Follow-up - Confirm functional requirements individually (FR-015)

- [X] T026 [US1] Add tests to `test/sections.test.js`: each `- **FR-NNN**` / `* **FR-NNN**` item is its own section with `kind: 'requirement'` and `heading: 'FR-NNN'`; wrapped lines stay with their requirement; an FR line inside a fence does not split; preamble has `kind: 'preamble'`.
- [X] T027 [US1] In `src/sections.js`, start a section at lines matching `^ {0,3}[-*+] +\*\*(FR-\d+)\*\*` outside fences, and add `kind` (`preamble` | `heading` | `requirement`) to every section.
- [X] T028 [US1] In `public/app.js` and `public/style.css`, label requirement toggles "Confirm" / "Confirmed ✓" and indent requirement sections under their heading.

---

## Phase 8: User Story 4 - Ask an existing Claude session about selected text (Priority: P4)

**Independent Test**: Select a sentence, ask a session that knows an unstated fact, and the answer uses it. The original session file has no trace of the question.

- [X] T029 [P] [US4] Add tests to `test/server.test.js` using a fake HOME session and a fake `claude` (`PICKY_CLAUDE`): sessions listed with custom title, first-prompt fallback, found from a subfolder; first ask passes `-p --resume <id> --fork-session --permission-mode plan`, prompt on stdin includes file, selection and question; follow-up resumes the returned fork without `--fork-session`; 400 for non-UUID or empty question, 404 for unknown session.
- [X] T030 [US4] In `src/server.js`, add `GET /api/sessions` (walk up from the opened root to the nearest `~/.claude/projects/<path with non-alphanumerics as '-'>` that has `*.jsonl`; newest 30; title = last `customTitle`, else last `aiTitle`, else first prompt; `cwd` from the log) and `POST /api/ask` (spawn `claude` with no shell, prompt on stdin, `CLAUDECODE` unset, 10-minute timeout; forks it created are remembered so follow-ups continue them; 502 with Claude's error on failure).
- [X] T031 [US4] In `public/index.html`, `public/app.js` and `public/style.css`, show an "Ask Claude" button under a text selection in the file view, a side panel with session picker, quoted selection, question box (⌘/Ctrl+Enter sends), thread, New thread and Close; keep the question on error; don't open the section editor when the click ends a selection.

- [X] T032 [P] [US4] Add tests to `test/server.test.js` (fake `claude agents --json` and relay): `GET /api/live` orders related sessions first and flags shared names; `POST /api/send` relays file, quoted selection and question to the named session with `--no-session-persistence`, `--tools SendMessage,ListAgents`, `dontAsk`; 404 unknown name, 409 shared name, 400 empty question, 502 with the relay's reason when it reports FAILED.
- [X] T033 [US4] In `src/server.js`, add `GET /api/live` (from `claude agents --json`) and `POST /api/send` (a Haiku `claude -p` relay limited to SendMessage/ListAgents, message between unguessable markers, success only on `SENT`); share JSON-output parsing with `ask` via a `claude()` helper.
- [X] T034 [US4] In `public/app.js` and `public/style.css`, group the session picker into "Live session · answer appears in its terminal" (shared names disabled) and "Copy of a saved session · answer appears here"; reload it each time the panel opens; show a "Sent to …" note for live sends.

- [X] T035 [P] [US4] Update tests in `test/server.test.js`: the fake relay runs in stream-json mode, acks each send with SENT and emits `REPLY: …`; `POST /api/send` returns a `thread`, `GET /api/thread?id&after` returns its replies (multi-line kept), a follow-up with `thread` reuses the same relay process, unknown thread is 404.
- [X] T036 [US4] In `src/server.js`, replace the one-shot relay with a long-lived one (`--input-format stream-json`, rules in `--append-system-prompt`): each send is one stdin message, its SENT/FAILED result resolves the request, later `REPLY:` results are stored on the thread; relays stop after 30 idle minutes, after a failed first send, or when the server closes; timers are `unref`'d.
- [X] T037 [US4] In `public/app.js`, keep the live thread id, poll `GET /api/thread` every 2 s and add each reply as a Claude message; show "Sent. Waiting for … to answer…" until one arrives; New thread / session change stops polling.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: needs T001. T003, T004 and T005 run in parallel. T006 needs T004 and T005. T007 needs T006 for its routes, but can be written alongside it.
- **US1 (Phase 3)**: needs Phase 2.
- **US2 (Phase 4)**: needs Phase 2 and US1's `fileView` (T009) plus the section rendering in `renderView` (T012).
- **US3 (Phase 5)**: needs Phase 2. T023 needs T018's `dirty` flag. Without US2, treat `dirty` as always false.
- **Polish (Phase 6)**: needs all the stories you plan to ship.

### Within Each Story

- Tests first (they should fail), then the server route, then the page.
- `src/server.js` and `public/app.js` are shared files, so tasks touching the same file run in order, not in parallel.

### Parallel Opportunities

- T001 ∥ T002
- T003 ∥ T004 ∥ T005
- Inside each story, the test task ∥ the style task (T008 ∥ T014, T015 ∥ T019, T020 alongside the server task).

---

## Parallel Example: User Story 1

```bash
Task: "Write US1 API tests in test/server.test.js"            # T008
Task: "Style read/unread sections in public/style.css"        # T014
# then, in order (same files):
Task: "GET /api/file + fileView in src/server.js"             # T009
Task: "POST /api/mark in src/server.js"                       # T010
Task: "Counts in GET /api/dir in src/server.js"               # T011
Task: "openFile/renderView in public/app.js"                  # T012
Task: "Sidebar counts in public/app.js"                       # T013
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 and Phase 2: the scanner, store and server skeleton, with a directory opened from the command line.
2. Phase 3: review, mark, roll-up and persistence.
3. **Stop and validate**: `npm test` plus quickstart scenarios 2–4. At this point you can review real Spec Kit files.

### Incremental Delivery

1. Add US2: in-place editing with conflict-safe saves.
2. Add US3: open and switch directories from the page, grouped list, focus refresh.
3. Polish: performance check and the full quickstart run.

---

## Notes

- [P] = different files, no dependency on unfinished tasks.
- `src/server.js` and `public/app.js` are touched by several stories. Keep each story's change to its own routes and functions.
- Don't add dependencies beyond `marked`.
