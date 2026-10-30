# Quickstart: Spec Review App

## Prerequisites

- Node.js 22 or newer
- Any browser

## Setup and run

```sh
npm install
npm test                      # unit + integration tests (node:test)
npm start -- ~/some-speckit-project
```

Open the printed URL (`http://127.0.0.1:4321`). If you don't want to touch real files, use a copy of a project for the checks below.

## Validation scenarios

Each one maps to the spec. The API behavior behind them is in [contracts/api.md](./contracts/api.md).

1. **Open a directory (FR-001, FR-002, US3)**
   - Start with a project root that has a `specs/` folder. Only the files under `specs/` are listed, grouped by feature folder, each showing `0/N`.
   - Type a feature folder's path into the path field and open it. Only that folder's `.md` files are listed.
   - Type a path that doesn't exist. An error appears and the previous directory stays open.
   - Open an empty folder. A "no markdown files found" message appears.

2. **Review and roll-up (FR-003–FR-006, US1)**
   - Open `spec.md`. The preamble and every heading show as separate sections, all unread.
   - Mark 3 sections read. The file shows `3/N`, and so does its line in the list.
   - Mark one of them unread again. The file shows `2/N`.
   - Mark all sections read. The file shows as reviewed, in the list too.

3. **Persistence (FR-007, SC-003)**
   - Stop the server (Ctrl-C) and start it again. All read marks are unchanged.
   - Open the project root, then the feature folder. The same file shows the same progress both times.
   - `git status` in the project shows no changes caused by marking.

4. **Outside change resets only changed sections (FR-008, SC-005)**
   - With every section of `spec.md` read, edit one paragraph in another editor and save it.
   - Switch back to the browser window. Only that section shows as unread.

5. **Edit a section (FR-009, FR-010, SC-004, US2)**
   - Click a section. It turns into a text box with its raw markdown.
   - Change one word and save. `git diff` shows only that word changed, and the section is marked read.
   - Click a section, change something, and cancel. `git diff` shows nothing new.

6. **No lost edits (FR-011–FR-013, SC-006)**
   - Click a section and type something, but don't save. Change the same file in another editor, then save in the app. A "changed on disk" message appears, your text is still in the text box, and the other editor's change is still in the file.
   - Make the file read-only (`chmod a-w`) and save an edit. An error appears and your text is kept.
   - With unsaved text, click another section. A Save / Discard / Stay dialog appears. With unsaved text, close the tab. The browser asks you to confirm.

7. **Edge cases**
   - Open a file with `# comment` inside a fenced code block. It isn't split there.
   - Open a file with two identical "Acceptance Scenarios" sections. Marking one doesn't mark the other.
   - Open a `tasks.md` with 500 or more sections (you can generate one). It is ready in under 2 seconds (SC-007).

8. **Local-only safety (R9)**
   - `curl -H 'Host: evil.com' http://127.0.0.1:4321/api/dir` returns 403.
   - `curl -X POST -d '{}' http://127.0.0.1:4321/api/mark` (wrong content type) returns 415.
