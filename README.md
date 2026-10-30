# Picky

A local web app for carefully reviewing [Spec Kit](https://github.com/github/spec-kit) specs, or any markdown, one section at a time.

Each file is split into sections (headings, plus Spec Kit `FR-###` / `SC-###` requirements). You mark each section read, and progress rolls up to the file and the file list. Click a section to edit its markdown in place; only that slice of the file is rewritten.

## Features

- **Section-by-section review**: per-section read marks, `read/total` counts per file, fully-reviewed files flagged in the list.
- **Persistent progress**: marks are stored in `~/.picky/reviews.json`, never in your repo. If a section changes on disk, only that section goes back to unread.
- **In-place editing**: edits are refused if the file changed on disk since you opened it, so nothing gets overwritten.
- **Ask Claude**: select a passage and ask a question of a past Claude Code session for the project (forked, read-only plan mode, so your session is untouched), or send it to a running session and see its reply.
- **Local only**: binds to `127.0.0.1`, checks the `Host` header, and serves a strict CSP.

## Requirements

- Node.js 22+
- [Claude Code](https://claude.com/claude-code) on your `PATH`, only for the Ask Claude features

## Usage

```sh
npm install
npm start -- ~/path/to/project   # opens project/specs/ if it exists, else the folder itself
```

Then open http://127.0.0.1:4321. You can also open a different directory from the path field in the app.

`npm run dev` restarts on file changes. `npm test` runs the tests.

## Configuration

| Variable       | Default                    | Purpose                        |
| -------------- | -------------------------- | ------------------------------ |
| `PORT`         | `4321`                     | Port to listen on              |
| `PICKY_STORE`  | `~/.picky/reviews.json`    | Where read marks are kept      |
| `PICKY_CLAUDE` | `claude`                   | Claude Code binary to run      |

## Layout

- `src/server.js`: HTTP server, API, Claude Code integration
- `src/sections.js`: splits markdown into reviewable sections
- `src/store.js`: read-mark persistence
- `public/`: browser UI
- `specs/001-spec-review-app/`: the spec Picky was built from
