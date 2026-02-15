# M5 Plan: Burn-After-Use

Status: **Not Started**

## Release Goal

Rooms and tasks auto-delete on completion, with manual burn commands for sensitive coordination. Positions Weave.us as the anti-Asana: privacy over persistence.

## Features

### 1. Auto-Deletion on Room Completion
- When all tasks in a room are marked complete, prompt room members: "All tasks done. Delete room data?"
- Majority vote or room creator confirms → all encrypted data purged from relay
- Grace period (configurable, default 24h) before auto-purge
- Visual countdown indicator in room header

### 2. Manual Burn Command
- `/burn` command in chat — immediate destruction of all room data
- Requires room creator confirmation (WebAuthn re-auth)
- Purges: relay message store, IndexedDB task/reminder data, service worker cache
- Broadcasts "room destroyed" to all connected members before disconnect
- No undo. Confirmation dialog makes this clear.

### 3. Ephemeral Mode
- Room creation option: "Ephemeral — no persistence"
- In-memory only: messages and tasks exist only while tabs are open
- No relay storage, no IndexedDB, no service worker cache
- Visual indicator (flame icon?) so members know data is transient
- Useful for one-time sensitive coordination

## Design Decisions

- **Burn is irreversible** — by design. No soft-delete, no trash, no recovery.
- **Room creator controls burn** — prevents griefing by non-creators
- **Ephemeral mode is opt-in at creation** — can't convert existing rooms
- **Grace period for auto-delete** — prevents accidental data loss when tasks are toggled complete/incomplete rapidly

## Security Considerations

- Relay must support purge API (new relay endpoint)
- Purge must be authenticated (room creator's identity key signs the request)
- Relay confirms deletion to all connected clients
- Client-side: clear IndexedDB, service worker cache, localStorage
- No tombstones — purged data leaves no trace

## Prerequisites

- M3 complete (agent state cleanup must be part of burn)
- Relay purge endpoint designed and reviewed
- Security audit of deletion guarantees

## Estimated Complexity

Medium-High. Requires relay changes (purge API), client-side cleanup across multiple storage layers, and careful UX for irreversible actions.
