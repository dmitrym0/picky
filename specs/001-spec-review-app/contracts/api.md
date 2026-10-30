# HTTP API Contract

Base: `http://127.0.0.1:<PORT>` (default port 4321, set with the `PORT` environment variable).

Applies to every request:
- A `Host` header that isn't `127.0.0.1:<PORT>` or `localhost:<PORT>` gets `403` (R9).
- Every `POST` needs `Content-Type: application/json`, or it gets `415`.
- Errors return `{ "error": "<message>" }`.
- Types for `FileEntry`, `FileView` and `Section` are in [data-model.md](../data-model.md).

## GET `/`  and static files

Serves `public/index.html`, `public/app.js` and `public/style.css`. `/vendor/marked.js` serves marked's browser build from `node_modules`.

## GET `/api/dir`

Returns the currently opened directory and its files.

`200`
```json
{ "root": "/abs/proj", "scanRoot": "/abs/proj/specs", "files": [FileEntry, ...] }
```
`root` is `null` and `files` is `[]` if no directory has been opened yet. Files are sorted by `rel`.

## POST `/api/dir`

Opens a different directory (FR-001).

Body: `{ "path": "~/proj" }`. A leading `~` is expanded to the home folder.

- `200`: the same body as `GET /api/dir`, for the new directory.
- `400`: the path doesn't exist, isn't a directory, or can't be read. The previous directory stays open.

## GET `/api/file?path=<abs path>`

- `200`: `FileView`. Stale keys are pruned from the store as a side effect.
- `403`: the path isn't a `.md` file inside the opened `scanRoot`.
- `404`: the file doesn't exist. Its store entry is dropped.

## POST `/api/mark`

Body: `{ "path": "<abs>", "key": "<section key>", "read": true }`

- `200`: `FileView` (fresh, so counts are always correct).
- `403` / `404`: as for `GET /api/file`.
- The key isn't checked against the file. Stale keys get pruned the next time the file loads.

## POST `/api/save`

Replaces one section's text (FR-010).

Body:
```json
{ "path": "<abs>", "hash": "<FileView.hash>", "start": 120, "end": 480, "text": "## Heading\n\nnew body\n" }
```

- `200`: `FileView` after the write. Sections that overlap the edited range are marked read.
- `409`: `{ "error": "changed on disk", "view": FileView }`. The file changed since `hash`. Nothing is written. The client keeps the editor and the user's text open (FR-011).
- `400`: `start` and `end` aren't integers with `0 ≤ start ≤ end ≤ length`.
- `403` / `404`: as for `GET /api/file`.
- `500`: the write failed (for example, a read-only file). Nothing in the store changes (FR-013).

## Command line

```text
npm start [-- <directory>]
```
Prints `Picky: http://127.0.0.1:<PORT>`. If a directory is given, it's opened at startup. Exits with an error if the port is in use.
