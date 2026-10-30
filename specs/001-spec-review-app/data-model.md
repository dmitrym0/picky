# Data Model: Spec Review App

Nothing is stored except the review store (R6). Everything else is computed from files on disk on each request.

## Opened directory (in memory, server)

| Field | Type | Notes |
|-------|------|-------|
| `root` | string | Absolute real path (`fs.realpath`) of the directory the user opened. |
| `scanRoot` | string | `root/specs` if that is a directory, otherwise `root` (FR-002). |

Validation: must exist and be a readable directory. Otherwise the open request fails with 400 and the previous directory stays open.

## File entry (computed, for the list)

| Field | Type | Notes |
|-------|------|-------|
| `path` | string | Absolute real path. The identity used everywhere, including the review store. |
| `rel` | string | Path relative to `scanRoot`, for display. |
| `folder` | string | Parent folder of `rel` (`""` for top level). The list is grouped by this. |
| `total` | int | Number of sections. |
| `read` | int | Number of sections whose key is in the review store. |
| `reviewed` | bool | `total > 0 && read === total` (FR-006). |

## Section (computed, per file)

| Field | Type | Notes |
|-------|------|-------|
| `index` | int | Order in file, from 0. |
| `kind` | string | `preamble`, `heading`, or `requirement` (an `FR-NNN` or `SC-NNN` list item, FR-015). |
| `heading` | string | Heading text without `#`s, the requirement ID (`FR-001`) for requirements, `""` for the preamble. |
| `level` | int | 1–6 for headings, 0 otherwise. |
| `start`, `end` | int | Character offsets `[start, end)` into the file text. Sections are contiguous and cover the whole file. |
| `text` | string | `fileText.slice(start, end)`. |
| `key` | string | `sha256(text)` + `#` + n, where n is the number of earlier sections with identical text (R5). |
| `read` | bool | `key ∈ store[path]`. |

Splitting rules (R4):
- A new section starts at a line matching `^ {0,3}#{1,6}(\s|$)` that is not inside a fenced code block.
- Outside fences, a line matching `^ {0,3}[-*+] +\*\*((?:FR|SC)-\d+)\*\*` also starts a new section (`kind: requirement`), running to the next heading or requirement.
- A fence opens at `^ {0,3}(`{3,}|~{3,})` and closes at a line holding a run of the same character at least as long.
- Text before the first heading is the preamble section; it is omitted when empty. A preamble of only whitespace is folded into the first heading's section instead, so there is no blank section to review.
- A file with no headings is one section. An empty file has 0 sections.
- Invariant: `sections.map(s => s.text).join("") === fileText`.

## File view (computed, returned when a file is opened or saved)

| Field | Type | Notes |
|-------|------|-------|
| `path` | string | As above. |
| `hash` | string | `sha256(fileText)`. The client sends it back on save for the conflict check (FR-011). |
| `sections` | Section[] | |
| `read`, `total`, `reviewed` | | As in File entry. |

## Review store (persisted)

File `~/.picky/reviews.json` (folder created when first needed):

```json
{
  "/Users/me/proj/specs/001-x/spec.md": ["9f2c…#0", "a17b…#0", "a17b…#1"]
}
```

- Key: absolute real path of a markdown file. Value: the section keys marked read.
- **Mark read**: add the key. **Mark unread**: remove the key.
- **Prune**: when a file is opened, drop keys that are not in its current sections. Drop a path's entry when the file no longer exists (spec edge case: a file deleted outside the app).
- **Save**: after a successful write, add the keys of every section whose `[start, end)` overlaps the edited range `[start, start + text.length)` in the new file (R7).
- Every write is atomic: write a temp file in the same folder, then rename.
- A missing or unreadable store file is treated as empty. An unreadable one is renamed to `reviews.json.bad-<timestamp>` first, so it is not silently overwritten.

## State transitions (one section)

```text
unread --mark--> read
read --unmark--> unread
read --text changed outside the app--> unread   (new key, not in store)
any  --saved in app--> read                     (new key added on save)
```
