# Milestone documents

One directory per milestone, holding the acceptance criteria and the implementation plan written before the work started. They are a record of intent. For what actually shipped, read `docs/ROADMAP.md`, and for where the project stands, read `docs/STATE.md`.

## Numbering

Three systems number these milestones and two of them agree. **The directories here are the odd one out.**

`docs/ROADMAP.md` and the GitHub milestones both collapse `M3.5` into `M4`, omit `M5.5`, and so run one number ahead from that point. The directory names keep `M3.5` and `M5.5` as their own entries.

The offset opens at `M3.5` and closes after `M9`, because this directory has an `M9` that ROADMAP does not, and ROADMAP has an `M10` that this directory does not. From `M11` onward all three agree.

| Directory | ROADMAP and GitHub call it | Sprint |
|-----------|---------------------------|--------|
| `M0-e2ee-room-core` | M0 | — |
| `M1-task-management` | M1 | — |
| `M2-task-intelligence` | M2 | — |
| `M3-agent-infra` | M3 | — |
| `M3.5-built-in-agent` | M4 | — |
| `M4-task-polish` | M5 | — |
| `M5-burn-after-use` | M6 | — |
| `M5.5-ux-polish` | *(omitted)* | — |
| `M6-session-security` | M7 | — |
| `M7-agent-hardening` | M8 | — |
| `M8-vulnerability-scanning` | M9 | 1 |
| `M9-encrypted-notifications` | *(no counterpart, superseded)* | — |
| *(no directory)* | M10, UX and Accessibility | 2 |
| `M11-reconnect-hardening` | M11 | 3 |
| `M12-mobile-ux` | M12 | 4 |
| `M13-mobile-identity-persistence` | M13 | 5 |
| `M14-local-notifications` | M14 | 6 |
| `M15-trust-verification` | M15 | 7 |
| `M16-web-push` | M16 | 8 |
| `M17-offline-task-store` | M17 | 9 |
| `M18-sync-conflict-resolution` | M18 | 10 |
| `M19-multi-room-tabs` | M19 | 11 |
| *(no directory)* | Production hardening | — |

Nothing is being renumbered. The directory names are referenced from commit messages, from issues, and from `SECURITY-REPORT.md`, and each scheme records part of the history. When a number is ambiguous, the directory name is the one to trust, because it is the name on disk.

## Gaps

**`M9-encrypted-notifications` was never built as specified.** It planned expanded service worker notifications, a local rules UI, and Web Push as one milestone. The work shipped split across two: `M14-local-notifications` and `M16-web-push`. The rules UI was cut on purpose. See the note at the top of that directory's files.

**M10 has no directory.** ROADMAP records it as UX and Accessibility, Sprint 2. The work shipped and its issues are closed under the GitHub milestone of the same name, but no acceptance or implementation document was written.

**The production hardening phase has no directory.** It had no milestone number, because it was not feature work. `docs/ROADMAP.md` carries the record, and the GitHub milestone of the same name carries its issues.
