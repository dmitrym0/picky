# Feature Specification: Spec Review App

**Feature Branch**: `001-spec-review-app`

**Created**: 2026-10-24

**Status**: Draft

**Input**: User description: "i want a web app that allows me to review and modify speckit-specs:https://github.com/github/spec-kit that are in markdown format. the primary goal is to be able to carefully review each file. that means that each section needs to be marked as read, and then it all rolls up to the file. clicking on a section makes it editable. then it's saved."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review a spec file section by section (Priority: P1)

A reviewer opens a directory, picks a markdown file (for example a feature's `spec.md`), and reads it one section at a time. After reading each section they mark it as read. The file shows how many of its sections are read, and once every section is read the file counts as fully reviewed. The reviewer can close the app and come back later; their progress is still there.

**Why this priority**: Careful, complete review is the stated primary goal. Without per-section read tracking and the roll-up to the file, the app has no reason to exist.

**Independent Test**: Open a directory holding one spec file of 6 sections, mark 4 as read, and confirm the file shows 4 of 6 read. Restart the app and confirm the same 4 sections are still read. Mark the last 2 and confirm the file shows as fully reviewed.

**Acceptance Scenarios**:

1. **Given** a spec file with no review progress, **When** the reviewer opens it, **Then** the file is shown split into its sections, every section is marked unread, and the file shows 0 of N sections read.
2. **Given** an open file, **When** the reviewer marks a section as read, **Then** that section is visibly marked read and the file's count goes up by one.
3. **Given** a section marked read, **When** the reviewer marks it unread, **Then** it goes back to unread and the file's count goes down by one.
4. **Given** a file where every section is read, **When** the reviewer views the file list, **Then** that file is shown as fully reviewed.
5. **Given** review progress on several files, **When** the reviewer leaves and later reopens the app, **Then** all read marks are exactly as they left them.

---

### User Story 2 - Edit a section in place (Priority: P2)

While reviewing, the reviewer finds a problem in a section. They click the section, it turns into an editable text area holding that section's markdown, they fix it, and they save. The change is written back to the original markdown file on disk, and the rest of the file is left exactly as it was.

**Why this priority**: Fixing problems found during review is the second half of the request. It depends on the section view from Story 1 but adds clear value on its own.

**Independent Test**: Click one section of a file, change one sentence, save, then open the file in any text editor and confirm only that sentence changed.

**Acceptance Scenarios**:

1. **Given** an open file, **When** the reviewer clicks a section, **Then** that section becomes editable and shows its raw markdown text.
2. **Given** a section being edited, **When** the reviewer saves, **Then** the change is written to the markdown file on disk, the section shows its updated rendered content, and every other part of the file is byte-for-byte unchanged.
3. **Given** a section being edited, **When** the reviewer cancels, **Then** the section returns to its previous content and nothing is written to disk.
4. **Given** a section being edited with unsaved changes, **When** the reviewer tries to open another section, switch files, or leave the app, **Then** they are warned and can choose to save, discard, or stay.

---

### User Story 3 - Open a directory and see review progress across its files (Priority: P3)

The reviewer opens any directory on their computer: a whole Spec Kit project, its `specs/` folder, or a single feature folder. The app lists every markdown file in it, grouped by folder, each with its review progress (sections read out of total, and whether it is fully reviewed). This tells them at a glance what is left to review. They can switch to a different directory at any time, and reopening a directory brings back its review progress.

**Why this priority**: Useful once more than one file is being reviewed, but a single file can be reviewed without it.

**Independent Test**: Open a directory with three feature folders holding spec, plan and tasks files; partly review two files; confirm the list shows correct progress for every file. Open a different directory, then reopen the first, and confirm the progress is unchanged.

**Acceptance Scenarios**:

1. **Given** any directory, **When** the reviewer opens it, **Then** every markdown file in it and its subfolders is listed, grouped by folder, with its read count and reviewed status.
2. **Given** the reviewer opens the root of a Spec Kit project (a directory containing a `specs/` folder), **When** the file list is shown, **Then** only the markdown files under `specs/` are listed, so templates and agent files are left out.
3. **Given** the file list, **When** the reviewer selects a file, **Then** it opens in the section-by-section review view.
4. **Given** an open directory, **When** the reviewer opens a different directory, **Then** the file list switches to the new directory; reopening the first directory later shows its progress as it was left.

---

### User Story 4 - Ask an existing Claude session about selected text (Priority: P4)

While reviewing, the reviewer selects some text and asks a question about it. They choose one of the Claude Code sessions that already exist for this project (for example the session that wrote the spec), so the answer draws on that session's history. The answer appears in a side panel, and they can ask follow-up questions.

**Why this priority**: The reviewer asked for it, to find out why a spec says what it says. Review still works without it.

**Independent Test**: Select a sentence, pick a session that knows a fact the sentence doesn't state, ask about it, and confirm the answer uses that fact. Confirm the original session's history has not changed.

**Acceptance Scenarios**:

1. **Given** text selected in a file, **When** the reviewer chooses Ask Claude, **Then** a panel opens showing the selected text and a list of the project's existing Claude Code sessions, newest first.
2. **Given** a chosen session and a question, **When** the reviewer asks, **Then** the answer appears in the panel, drawn from that session's history, and the original session is left unchanged.
3. **Given** an answer, **When** the reviewer asks a follow-up, **Then** it continues the same conversation.

---

### Edge Cases

- **File changed outside the app** (for example, a Spec Kit command regenerates `plan.md`): when the file is next shown, any section whose content changed is reset to unread; sections whose content did not change keep their read mark. Read marks for sections that no longer exist are dropped.
- **File changed outside the app while a section is being edited**: on save, the app detects that the file on disk changed since it was opened, does not overwrite it, and tells the reviewer, keeping their unsaved text so it is not lost.
- **Edit adds, removes, or renames headings**: after save, the file is re-split into sections. Sections created or changed by the edit are marked read (the reviewer just wrote them); other sections keep their state.
- **Edit empties a section completely**: the section is removed from the file and from the count.
- **Text before the first heading**: treated as its own section (the file preamble) so it is reviewed too.
- **File with no headings**: treated as one section.
- **Two sections with the same heading text** (for example several "Acceptance Scenarios" headings): each is tracked separately.
- **Functional requirements and success criteria**: each `FR-NNN` and `SC-NNN` list item is confirmed on its own, not as part of its section. Text after a requirement (for example a wrapped line or a note) belongs to that requirement.
- **Headings inside code blocks**: lines starting with `#` inside fenced code blocks are not treated as section boundaries.
- **File deleted or renamed outside the app**: it disappears from the list; its stored progress is discarded.
- **File cannot be saved** (for example, read-only on disk): the reviewer sees an error and their unsaved text is kept.
- **Opened directory has no markdown files**: the reviewer sees a clear "no markdown files found" message, not an empty screen.
- **Opened directory does not exist or cannot be read**: the reviewer sees an error and can pick another directory.
- **Same file reached from two opened directories** (for example the project root, then its feature folder): it shows the same review progress both times.
- **No Claude Code sessions for the directory**: the panel says so instead of showing an empty list.
- **Asking fails** (Claude Code not installed, session gone, error from Claude): the panel shows the error and keeps the typed question.
- **Selecting text to ask about** does not open the section editor.
- **Very large file** (for example a `tasks.md` with hundreds of sections): the file still opens and the read count stays correct.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to open any directory on their own computer to review, and switch to a different directory at any time.
- **FR-002**: System MUST list every markdown file in the opened directory and all its subfolders (such as `checklists/` and `contracts/`), grouped by folder. If the opened directory contains a `specs/` folder, the list MUST be limited to the markdown files under `specs/`.
- **FR-003**: System MUST split each markdown file into sections, where every heading (any level) starts a new section that runs until the next heading, and any text before the first heading forms its own section.
- **FR-004**: System MUST show each section's rendered markdown and its read/unread state.
- **FR-005**: Users MUST be able to mark any section as read and mark it back as unread.
- **FR-006**: System MUST show, for each file, the number of sections read out of the total, and MUST show the file as fully reviewed only when every section is read.
- **FR-007**: System MUST keep read state between sessions without writing anything into the reviewed markdown files; a file's read state MUST be the same no matter which directory it was opened from.
- **FR-008**: System MUST reset a section to unread when its content changes outside the app, and MUST keep the read mark on sections whose content is unchanged.
- **FR-009**: Users MUST be able to click a section to edit its raw markdown, with only one section editable at a time.
- **FR-010**: Users MUST be able to save or cancel an edit; saving MUST write the change to the original file on disk and leave all other bytes of the file unchanged.
- **FR-011**: System MUST NOT overwrite a file that changed on disk after it was opened; it MUST tell the user and keep their unsaved text.
- **FR-012**: System MUST warn before discarding unsaved edits when the user moves to another section, another file, or leaves the app.
- **FR-013**: System MUST show a clear error and keep unsaved text if a save fails.
- **FR-014**: System MUST NOT treat `#` lines inside fenced code blocks as headings.
- **FR-015**: System MUST treat each functional requirement and success criterion list item (a line starting `- **FR-NNN**` or `- **SC-NNN**`) as its own item to confirm, running until the next such item or heading, so every one is confirmed individually and counts toward the file's roll-up.

- **FR-016**: Users MUST be able to select text in a file and ask a question about it.
- **FR-017**: System MUST list the existing Claude Code sessions of the opened directory (or the nearest parent folder that has sessions), newest first, by name.
- **FR-018**: System MUST answer from a copy of the chosen session, so the original session's history is never changed, and the copy MUST NOT be able to change files.
- **FR-019**: Follow-up questions MUST continue the same copied conversation until the reviewer starts a new thread or picks another session.
- **FR-020**: Users MUST also be able to send the selected text and question into a running Claude Code session, where it arrives as a message; that session's reply MUST appear in Picky's panel, and follow-up questions MUST go to the same session. Running sessions related to the opened directory MUST be listed first.
- **FR-021**: System MUST refuse to send to a session whose name is shared by another running session, and MUST tell the user to rename one; it MUST report when a message could not be delivered and keep the question.

### Key Entities

- **Opened directory**: The directory the user chose to review. It can be a Spec Kit project root, its `specs/` folder, a single feature folder, or any other folder of markdown files.
- **Folder**: A subfolder of the opened directory (for example the feature folder `001-user-auth`) used to group files in the list.
- **Spec file**: One markdown file. Has an ordered list of sections, a read count, and a reviewed status derived from its sections.
- **Section**: A heading plus the content up to the next heading (or the file preamble). Identified by its position and heading in the file; has content and a read state.
- **Review record**: The stored read state for each section of each file, linked to the section's content so that changes made outside the app can be detected.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can open a directory and start reviewing a chosen file in under 30 seconds.
- **SC-002**: Marking a section read or unread updates the file's count with no noticeable delay (under half a second).
- **SC-003**: 100% of read marks survive closing and reopening the app.
- **SC-004**: After any in-app save, a text comparison of the file before and after shows changes only inside the edited section, in 100% of tested files.
- **SC-005**: When a file is changed outside the app, 100% of changed sections show as unread and 100% of unchanged sections keep their read mark.
- **SC-006**: No user edit is ever lost to a failed save or an outside change (0 lost edits across all edge-case tests).
- **SC-007**: A file of 500 sections opens and is ready to review in under 2 seconds.

## Assumptions

- Single user on their own computer; no accounts, sign-in, or sharing. The app runs locally and works with files on the local disk.
- When a Spec Kit project root is opened, only its `specs/` folder is reviewed, since that is where Spec Kit puts feature documents by default.
- Files are read from and saved to the local disk directly. Pulling from or pushing to a remote repository (for example on GitHub) is out of scope; the user commits changes with their normal tools.
- All markdown files in the opened directory are reviewable (spec, plan, tasks, research, data model, quickstart, checklists, contracts), not only `spec.md`.
- Saving an edit marks the edited section as read, since the reviewer just wrote it.
- Read state is stored by the app outside the reviewed files (FR-007), so specs stay clean for version control.
- Out of scope for v1: creating or deleting files, editing a whole file at once, comments or discussion threads, edit history or undo after save, running Spec Kit commands from the app, and feature-level or project-level review roll-ups beyond the per-file list.
