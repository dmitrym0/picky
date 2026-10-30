# Research: Spec Review App

All Technical Context items are resolved below. Guiding rule: the fewest moving parts that meet the spec.

## R1. App shape: local server + static page vs browser-only

- **Decision**: A small local Node.js server (built-in `node:http`, no framework) that serves one static page and a JSON API. It reads and writes files on disk.
- **Rationale**: The spec needs absolute file identity (same file opened from two directories shows the same progress, FR-007), opening a directory by path, safe writes with conflict detection (FR-011), and progress stored outside the reviewed files. A server gets all of this from `node:fs` and works in any browser.
- **Alternatives considered**:
  - *Browser-only with the File System Access API*: no server, but Chromium-only, no absolute paths (so FR-007 cross-directory identity is not possible), and permission prompts every session.
  - *Electron/Tauri desktop app*: native folder picker, but a large toolchain for a one-user local tool.
  - *Express/Fastify*: not needed for about 6 routes.

## R2. Opening a directory

- **Decision**: Pass the directory as a command-line argument when starting (`npm start -- ~/proj`). The page also has a path field to open or switch to any other directory (FR-001). The server resolves the path with `fs.realpath` and rejects paths that are not readable directories.
- **Rationale**: A path field is the least code and works for every directory. Browsers can't hand a real absolute path to a page, so a native picker isn't possible without a desktop shell.
- **Alternatives considered**: An in-page folder browser (a list of subfolders to click through). Deferred: it adds an endpoint and UI, and pasting a path is fast for a developer tool.

## R3. Which files are listed

- **Decision**: Walk the opened directory with `fs.readdir(..., { recursive: true })` and keep `*.md` files. If `<dir>/specs` is a directory, walk only that (FR-002). Skip hidden folders (`.git`, `.specify`, `.claude`) and `node_modules`.
- **Rationale**: Matches the spec and keeps an arbitrary folder from listing thousands of vendored files.
- **Note**: Skipping hidden folders and `node_modules` goes slightly beyond the spec text ("every markdown file"). It's recorded here as a deliberate default.

## R4. Splitting markdown into sections without losing bytes

- **Decision**: A hand-written line scanner over the raw file text. An ATX heading (`#` to `######` followed by a space or end of line, with up to 3 leading spaces) outside a fenced code block starts a new section. Fences open on a line of 3+ backticks or tildes and close on a matching run of the same character that is at least as long. Text before the first heading is the preamble section. Each section stores its `[start, end)` character offsets into the original string, so joining the sections gives back the exact file.
- **Rationale**: FR-010 and SC-004 need edits spliced into the original bytes. A markdown parser's AST does not round-trip source exactly. The scanner is about 30 lines and can be fully unit-tested.
- **Shortcut**: Setext headings (`Title` followed by `===`) are not treated as section boundaries. Spec Kit templates use ATX headings only. Revisit if real files use setext.
- **Alternatives considered**: `marked.lexer` token positions. It doesn't expose reliable source offsets for every token, and it's harder to test against byte-exact output.

## R5. Tracking read state so outside changes reset only changed sections

- **Decision**: A section's key is `sha256(section text)` plus `#n`, where `n` counts earlier sections in the same file with identical text. Per file, the store keeps the set of keys marked read. A section is read when its current key is in the set. Keys that are no longer in the file are pruned when it loads.
- **Rationale**: This meets FR-008 and SC-005 with no file watching and no diffing. Changed text gives a new key, so the section shows as unread. Unchanged text keeps its key, even if the section moves. The `#n` suffix keeps identical duplicate sections separate (spec edge case).
- **Alternatives considered**: A key of heading path plus position, stored next to a content hash. More code, and every insertion above a section shifts its position.

## R6. Where read state lives

- **Decision**: One JSON file at `~/.picky/reviews.json`, shaped `{ "<absolute real path of file>": ["<key>", ...] }`. It's written atomically: write to a temp file in the same folder, then `rename`.
- **Rationale**: Keeps the reviewed files clean (FR-007). Keying by real path gives one record per file whichever directory was opened (FR-007). The atomic rename means a crash can't corrupt progress (SC-003). The data is a few hundred KB at most.
- **Alternatives considered**: SQLite (not needed at this size) and a sidecar file inside each project (pollutes version control).

## R7. Saving edits safely

- **Decision**: The client sends `{ path, fileHash, start, end, text }`. The server re-reads the file and compares `sha256(current)` with `fileHash`. If they differ, it replies `409` and writes nothing (FR-011). If they match, it writes `current.slice(0,start) + text + current.slice(end)`. It then re-splits the file and marks as read every section that overlaps the replaced range (spec edge case: the edited section is marked read), and returns the new file view. Write errors return `500` with the error message. The client keeps the editor open with the user's text on any non-200 reply (FR-013).
- **Rationale**: Byte-exact splice (SC-004) and no lost edits (SC-006), with one hash comparison.
- **Note**: The newline before the next heading belongs to the edited section. The client adds one back on save if the user removed it, so the next heading doesn't merge into the edited text.

## R8. Rendering markdown

- **Decision**: `marked` (one runtime dependency), served to the page from `node_modules`. Raw HTML in markdown is escaped, not rendered, by overriding marked's `html` renderer.
- **Rationale**: Mature, small, and has no dependencies of its own. Escaping raw HTML stops a hostile markdown file from running script in the page, which can call the local API that writes files.
- **Alternatives considered**: `markdown-it` (equivalent; marked chosen for a smaller API) and DOMPurify sanitizing (a second dependency, not needed once HTML is escaped).

## R9. Local server security

- **Decision**: Bind to `127.0.0.1` only. Reject any request whose `Host` header isn't `127.0.0.1:<port>` or `localhost:<port>` (blocks DNS rebinding). `POST` requires `Content-Type: application/json`, so other sites can't send it without a CORS preflight, which the server never approves. Writes are allowed only to existing `.md` files inside the currently opened directory.
- **Rationale**: The server can read and write the user's files, so this is a trust boundary. These checks are a few lines.

## R10. Testing

- **Decision**: The built-in `node:test` runner. Unit tests cover the section scanner: round-trip, fences, preamble, no headings, duplicates. Integration tests start the server on a temp directory and cover list, mark, save, 409 conflict, outside-change reset, and the Host check. The UI is checked by hand using `quickstart.md`.
- **Rationale**: No test dependencies. The risky logic (splitting, hashing, splicing, conflicts) all sits server-side and is covered by these tests.

## R11. Unsaved-edit guard

- **Decision**: The page tracks a dirty flag. Opening another section, switching files, or opening another directory while dirty shows a small `<dialog>` with Save, Discard and Stay. Closing the tab uses the browser's `beforeunload` prompt (FR-012).
- **Rationale**: Built-in browser features only.

## R12. Keeping the list current

- **Decision**: Re-fetch the file list and the open file when the browser window regains focus. No file watcher.
- **Rationale**: Outside changes (for example, an agent rewriting `plan.md`) appear when the user comes back to the app, using one `focus` listener. If the open file changed while a section is being edited, the save path already catches the conflict.
