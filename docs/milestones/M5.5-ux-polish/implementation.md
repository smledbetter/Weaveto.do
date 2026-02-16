# M5.5 Implementation Plan: UX Polish

## Context

M5 shipped burn-after-use. Users can now create rooms, coordinate tasks, and destroy them. But first-time users — especially invited users landing on a join page — get no guidance. Room URLs are hex hashes, modes are a checkbox, and the agent panel has no explanation. M5.5 fixes all of these with zero functional changes to crypto, relay, or task infrastructure.

Builds on: `src/routes/+page.svelte` (homepage), `src/routes/room/[id]/+page.svelte` (room page), `src/lib/components/AgentPanel.svelte`, `src/lib/components/InviteModal.svelte`.

## must_haves

### truths (observable outcomes)
- Homepage shows named radio buttons (Standard / Ephemeral) instead of a checkbox
- Room names are deterministic 2-word phrases derived from room ID hash
- Room URLs use `/swift-falcon` format (with `/room/[hex]` still working)
- Join page shows room name and friendly onboarding copy
- Agent panel has explainer text at the top
- User's own display name visible in room header
- Page titles include room name

### artifacts (files produced)
- `src/lib/room/names.ts` — deterministic 2-word name generator from room ID
- `src/routes/[slug]/+page.svelte` — short URL route (resolves slug → room ID)
- `src/routes/[slug]/+page.server.ts` — server load function for slug resolution
- Modified: `src/routes/+page.svelte` — radio buttons, mode descriptions
- Modified: `src/routes/room/[id]/+page.svelte` — room name header, display name, onboarding copy
- Modified: `src/lib/components/AgentPanel.svelte` — explainer text
- Modified: `src/lib/components/InviteModal.svelte` — short URL
- `tests/unit/room/names.test.ts` — room name generator tests
- `tests/e2e/ux-polish.spec.ts` — E2E tests for all UX changes

### key_links (where breakage cascades)
- Room name generator used in: room page header, page title, join page, invite modal, short URL route
- Short URL route must resolve to the same room as `/room/[hex]`
- Homepage mode selection must produce the same URL params as before (`?create=1&ephemeral=true`)
- InviteModal URL generation changes from `/room/[hex]` to `/[slug]`

## Waves

### Wave 1: Room Name Generator + Homepage Mode Selection
> No dependencies. Foundation for all subsequent waves.

**Task 1.1** (type: auto)
- **Files**: `src/lib/room/names.ts`
- **Action**: Deterministic 2-word name generator. Two word lists (adjectives + nouns, ~256 each). Take first 2 bytes of SHA-256(roomId) → index into each list. `getRoomName(roomId: string): string` returns "adjective-noun". Same input always produces same output. Zero dependencies (use WebCrypto for hash, but since this runs in both server and client contexts, use a simple non-crypto hash — first 2 bytes of the hex room ID as indices into word lists).
- **Verify**: Unit test: same ID → same name, different IDs → different names (collision-resistant for practical use)
- **Done**: `getRoomName()` is pure, deterministic, and fast

**Task 1.2** (type: auto)
- **Files**: `src/routes/+page.svelte`
- **Action**: Replace ephemeral checkbox with radio button group. Two options: "Standard" (default) and "Ephemeral". Each has a short description. Standard: "Tasks persist until completed or deleted. Best for ongoing projects." Ephemeral: "Nothing saved. Room disappears when everyone leaves. Best for one-time coordination." Radio buttons set `ephemeralMode` state. Visual: clean card layout, accessible with keyboard, `role="radiogroup"`.
- **Verify**: Visual check, keyboard navigation, correct URL params on create
- **Done**: Mode selection is clear, accessible, produces correct room type

### Wave 2: Room Page UX + Short URLs
> Depends on: Wave 1 (room name generator)

**Task 2.1** (type: auto)
- **Files**: `src/routes/room/[id]/+page.svelte`
- **Action**: Import `getRoomName`. Show room name in header instead of "Room". Set page title to `{roomName} — weaveto.do`. Show user's display name in header (subtle, near member count): "You: {displayName}". Update join page (phase='name') copy: show room name as heading, "You've been invited to a private, encrypted room." subtitle, placeholder "What should we call you?", auth note "Your fingerprint creates a temporary identity for this session. Nothing is stored."
- **Verify**: Room name visible in header and tab title, friendly join copy, display name shown
- **Done**: Room page shows room identity and improved onboarding

**Task 2.2** (type: auto)
- **Files**: `src/routes/[slug]/+page.svelte`, `src/routes/[slug]/+page.server.ts`
- **Action**: Create short URL route. The slug IS the room name. Server load function: iterate known approach — since room names are derived from room IDs, and we can't reverse a hash, the short URL route needs a lookup. Approach: the short URL page receives the slug, generates the room page client-side by brute-forcing... NO. Better approach: encode the room ID in the slug directly. Use base36 encoding of the room ID truncated to fit, with the 2-word name as a vanity prefix. OR simpler: the short URL `/swift-falcon` is just a redirect. Store a mapping in sessionStorage when creating a room. Actually, simplest: the short URL is `/[slug]` where slug = roomId. The 2-word name is display-only, derived client-side. The actual URL is still `/room/[id]` but the invite modal can show both. This avoids needing server-side slug resolution entirely. REVISED: Keep `/room/[id]` as the canonical URL. The room name is display-only (header, title, invite modal label). The invite URL remains `/room/[id]` but the modal shows the room name prominently above it. This is simpler and avoids routing complexity.
- **Verify**: Invite modal shows room name + URL clearly
- **Done**: Room identity is clear without URL routing changes

**Task 2.3** (type: auto)
- **Files**: `src/lib/components/InviteModal.svelte`
- **Action**: Import `getRoomName`. Show room name as heading in invite modal (above QR code). Keep URL as `/room/[id]` (canonical). Add room name label: "Room: swift-falcon" prominently at top.
- **Verify**: Invite modal shows room name clearly
- **Done**: Invite modal has room identity

### Wave 3: Agent Panel Explainer
> Depends on: nothing (can run parallel with Wave 2)

**Task 3.1** (type: auto)
- **Files**: `src/lib/components/AgentPanel.svelte`
- **Action**: Add explainer section at top of panel (before module list). Text: "Agents run small automations inside your room. They can read tasks and assign them, but never see your messages." Below: "The auto-balance agent distributes unassigned tasks evenly. More agents coming soon." Style: muted text, info-card look. Add note to Advanced toggle: "Upload a custom WASM agent. For developers only."
- **Verify**: Visual check, text readable, doesn't push module list too far down
- **Done**: Agent panel has clear explainer

### Wave 4: Tests
> Depends on: Waves 1-3

**Task 4.1** (type: auto)
- **Files**: `tests/unit/room/names.test.ts`
- **Action**: Unit tests for room name generator: determinism (same input → same output), different inputs → different outputs (spot check 20 random IDs), output format matches "word-word" pattern, both words from valid word lists
- **Verify**: `npm run test:unit` passes
- **Done**: 90%+ coverage on names.ts

**Task 4.2** (type: auto)
- **Files**: `tests/e2e/ux-polish.spec.ts`
- **Action**: E2E tests: homepage shows radio buttons (Standard/Ephemeral), Standard selected by default, selecting Ephemeral and creating room adds ephemeral param, room page shows 2-word name in header, page title includes room name, join page shows friendly copy, agent panel has explainer text, display name visible in room header
- **Verify**: `npm run test:e2e` passes, 0 regressions
- **Done**: All acceptance criteria covered

### Final Wave: Ship-Readiness Gate
> Depends on: all prior waves

**Ship-Readiness Review** (type: checkpoint:gate)
- **Skills**: `production-engineer` + `security-auditor` (single agent, one pass)
- **Action**: Run quality gates (unit tests with coverage, E2E, type check) AND security audit on changed files. Focus: no new XSS vectors in copy changes, room name generator doesn't leak room ID patterns, no new dependencies.
- **Verify**: All gates pass. Fix any failures, re-run until clean.
- **Done**: 0 test failures, 80%+ coverage on new code, 0 type errors, 10/10 security, 0 vulnerabilities

## Agent Strategy

| Wave | Agent | Model | Tasks |
|------|-------|-------|-------|
| 1 | Worker A | haiku | 1.1 (name generator) |
| 1 | Worker B | haiku | 1.2 (homepage radio buttons) |
| 2 | Worker A | haiku | 2.1 (room page UX) |
| 2 | Worker B | haiku | 2.2 (revised: no short URL route), 2.3 (invite modal) |
| 3 | Worker C | haiku | 3.1 (agent panel explainer) — parallel with Wave 2 |
| 4 | Solo | sonnet | 4.1, 4.2 (tests) |
| Final | Ship-Readiness | sonnet | Quality gates + security audit |

## Design Decision: Short URLs

After analysis, implementing `/swift-falcon` as a real route requires either:
1. Server-side slug→roomId mapping (relay needs a new endpoint, breaks stateless model)
2. Client-side brute-force hash reversal (impossible)
3. Encoding room ID in the slug (URL becomes long, defeats purpose)

**Decision**: Room names are display-only. The canonical URL stays `/room/[id]`. The room name appears in: page title, room header, invite modal heading, join page heading. This delivers 90% of the verbal-shareability value ("join my room swift-falcon") while keeping the architecture stateless. True short URLs can be revisited when/if we add a URL shortener service.

## Estimated Tokens

| Wave | Est. Tokens |
|------|-------------|
| Wave 1: Name generator + homepage modes | ~15K |
| Wave 2: Room page UX + invite modal | ~15K |
| Wave 3: Agent panel explainer | ~5K |
| Wave 4: Tests | ~10K |
| Ship-Readiness Gate | ~8K |
| **Total** | **~53K** |
