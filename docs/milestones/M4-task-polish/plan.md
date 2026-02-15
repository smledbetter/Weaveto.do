# M4 Plan: Task Polish

Status: **Not Started**

## Release Goal

Users can describe, sort, and triage tasks more effectively within ephemeral rooms.

## Features

### 1. Task Descriptions
- Add `description?: string` field to Task interface
- Description input (textarea) in TaskCreateModal
- Description display in TaskPanel (expandable, below title)
- Inline editing for descriptions (click to edit, Enter saves)
- Encrypted like all task data — zero plaintext on relay

### 2. Due Date Sorting
- Single sort toggle in TaskPanel header: Due Date Asc → Due Date Desc → Creation Order
- Client-side only, no persistence (resets on reload)
- Tasks without due dates sort to bottom

### 3. Quick-Pick Date Buttons
- Replace bare text input with: [Today] [Tomorrow] [Next Week] + custom text field
- Quick-pick sets the dueInput value, custom field still supports NL parsing
- Reduces friction for the 80% case

### 4. Urgent Flag
- Binary `urgent?: boolean` field on Task (not P1-P4 priority levels)
- Toggle in create modal and inline on task row
- Visual indicator: red dot or highlight on urgent tasks
- Urgent tasks sort above non-urgent (when sorting enabled)

### 5. Room-Scoped Task Search
- Search input at top of TaskPanel
- Client-side keyword match on title + description (decrypted data only)
- Filters task list in real-time as user types
- No cross-room search (privacy isolation)

## Design Decisions

- **No priority levels** — Binary urgent flag is simpler, less cognitive load
- **No saved filters** — No persistent user state (no accounts). Session-only.
- **No calendar picker** — Quick-picks + NL parser cover 95% of use cases
- **Descriptions over comments** — Task discussion happens in room chat

## Prerequisites

- M3.5 complete (built-in agent ships first per PM recommendation)

## Estimated Complexity

Low-Medium. All features are additive UI + small schema changes. No architectural shifts.
