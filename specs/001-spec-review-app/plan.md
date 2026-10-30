# Implementation Plan: Spec Review App

**Branch**: `001-spec-review-app` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-spec-review-app/spec.md`

## Summary

A local web app for reviewing Spec Kit markdown files one section at a time. The user opens any directory. The app lists its markdown files (only `specs/` when a project root is opened), splits each file into heading-delimited sections, and lets the user mark each section read. Progress rolls up to the file. Clicking a section opens its raw markdown for editing, and saving writes only that slice back to disk.

Technical approach: one small Node.js server using built-in modules only, serving a static page with no build step. Sections are found with a byte-exact line scanner. Read state is stored outside the reviewed files as content hashes, so text changed outside the app shows as unread again. Saves are refused if the file changed on disk since it was loaded. See [research.md](./research.md).

## Technical Context

**Language/Version**: JavaScript (ES modules), Node.js ≥ 22 on the server; plain browser JavaScript on the client

**Primary Dependencies**: `marked` (markdown rendering) is the only runtime dependency. The server uses `node:http`, `node:fs` and `node:crypto`.

**Storage**: Markdown files on local disk (read and written in place). Review progress goes in `~/.picky/reviews.json` (R6).

**Testing**: `node:test` (built in). Unit tests for the section scanner; integration tests for the HTTP API against a temp directory.

**Target Platform**: The user's own machine (macOS or Linux), any modern browser, server bound to `127.0.0.1`

**Project Type**: Local web app (single package: server plus static frontend)

**Performance Goals**: A 500-section file opens in under 2 seconds (SC-007). Mark and unmark respond in under 0.5 seconds (SC-002).

**Constraints**: Saves are byte-exact outside the edited section (SC-004). No edit is ever lost (SC-006). Nothing is written into reviewed files except user edits. Localhost only.

**Scale/Scope**: One user. Tens to hundreds of markdown files per directory. One page.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so it defines no principles and no gates. **PASS** (nothing to violate).

Post-design re-check: **PASS**. Run `/speckit-constitution` to set real principles; they will apply from the next plan on.

## Project Structure

### Documentation (this feature)

```text
specs/001-spec-review-app/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R12
├── data-model.md        # Phase 1: sections, keys, review store
├── quickstart.md        # Phase 1: run and validation scenarios
├── contracts/
│   └── api.md           # Phase 1: HTTP API + CLI contract
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
package.json             # "type": "module"; scripts: start, test; dependency: marked
src/
├── sections.js          # splitSections(text) -> Section[]  (R4, R5 keys)
├── store.js             # load/save ~/.picky/reviews.json, atomic write  (R6)
└── server.js            # http server, Host check, /api/* routes, static files, CLI arg  (R1, R2, R3, R7, R9)
public/
├── index.html           # path field, file list, file view, Save/Discard/Stay <dialog>
├── app.js               # fetch API, render sections with marked, edit/save, dirty guard, focus refresh
└── style.css
test/
├── sections.test.js     # round-trip, fences, preamble, no headings, duplicate keys
└── server.test.js       # list, specs/ scoping, mark, save, 409, outside-change reset, 403/415
```

**Structure Decision**: One package with three small server modules and a static `public/` folder. There's no separate frontend build or framework, since the UI is a single page. `sections.js` is kept apart from the server so the riskiest logic can be unit-tested on its own.

## Complexity Tracking

No constitution violations to justify.

Things deliberately left out (each listed in research.md):
- An in-page folder browser (R2)
- A file watcher (R12)
- Setext heading support (R4, marked as a shortcut)
- DOMPurify (R8)
