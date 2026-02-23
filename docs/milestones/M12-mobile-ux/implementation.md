# M12 — Mobile UX Improvements: Implementation Plan

## Overview

Two changes, no new dependencies, no crypto, no relay changes.

1. **Banner consolidation**: Merge 3 informational banners into the CoachMarks walkthrough
2. **Mobile bottom nav**: Replace header toggles + mobile tab bar with a unified bottom nav

## Wave Plan

### Wave 1: CoachMarks Enhancement (serial — touches shared state)

**Agent**: sonnet (logic + conditional steps)

**Files to read**:
- `src/lib/components/CoachMarks.svelte` (current walkthrough)
- `src/routes/room/[id]/+page.svelte` (banner conditions, lines 806-940)

**Files to write**:
- `src/lib/components/CoachMarks.svelte`
- `src/routes/room/[id]/+page.svelte`

**Changes**:

1. **CoachMarks.svelte** — make steps dynamic based on props:
   - Add props: `usingTempIdentity: boolean`, `isSoloMember: boolean`
   - Step 1 ("Your encrypted room"): update body to include key warning text
   - Step 2 ("Temporary identity"): conditionally include only if `usingTempIdentity`
   - Step 3 ("Manage tasks"): unchanged
   - Step 4 ("Invite your team"): update body to mention solo status if `isSoloMember`, add `onInvite` prop callback
   - On finish: dispatch `oncomplete` event with payload `{ dismissedBanners: ['key-warning', 'temp-identity', 'solo-member'] }`
   - Change storage from `sessionStorage` to `localStorage` (persist across sessions, not just current tab)

2. **+page.svelte** — suppress banners when walkthrough handles them:
   - Pass `usingTempIdentity` and `isSoloMember` to CoachMarks
   - On CoachMarks complete: set `sessionStorage` flags for key warning + solo member + temp identity
   - Also set a `localStorage` flag `weave-walkthrough-completed` so returning users skip banners entirely
   - Banner conditions add `&& !walkthroughCompleted` guard
   - Remove the redundant pre-join key warning banner (line 712-717) — it shows before the room is connected, when CoachMarks aren't active yet. The key warning only matters once you're in the room.

**Tests** (unit):
- CoachMarks: step count varies with props (3 steps without temp identity, 4 with)
- CoachMarks: completing sets localStorage flag
- CoachMarks: `oncomplete` fires with banner list

### Wave 2: Mobile Bottom Nav (parallel-safe — different DOM region)

**Agent**: sonnet (CSS layout + responsive logic)

**Files to read**:
- `src/routes/room/[id]/+page.svelte` (mobile tabs lines 885-911, CSS lines 1464-1515)

**Files to write**:
- `src/lib/components/MobileNav.svelte` (new — small component)
- `src/routes/room/[id]/+page.svelte`

**Changes**:

1. **MobileNav.svelte** — new component (bottom navigation bar):
   ```svelte
   Props: activeView ('chat' | 'tasks' | 'automation'), taskCount, agentCount
   Events: onnavigate(view)
   ```
   - 3 nav items with icons (chat bubble, checkmark, lightning bolt — CSS-only, no icon library)
   - Badge counts on Tasks and Automation items
   - Sticky to bottom of `.room` container
   - `display: none` by default, `display: flex` at `max-width: 767px`

2. **+page.svelte** — replace mobile tab system:
   - Replace `mobileTab` state with `mobileView: 'chat' | 'tasks' | 'automation'` (always active on mobile, not gated by `showTaskPanel`)
   - Remove `.mobile-tabs` div entirely (lines 885-911)
   - Remove `showTaskPanel`/`showAgentPanel` toggle buttons from header on mobile (CSS `display: none` at 767px)
   - Add MobileNav at the bottom of `.room` div
   - Column visibility on mobile driven by `mobileView` instead of `showTaskPanel && mobileTab`
   - Composer only visible when `mobileView === 'chat'`
   - Desktop: no changes (side panels still controlled by `showTaskPanel`/`showAgentPanel`)

**Tests** (unit):
- MobileNav: renders 3 items, highlights active
- MobileNav: shows badge counts
- MobileNav: fires onnavigate

### Wave 3: Integration + Polish

**Agent**: haiku (mechanical wiring)

**Files to read/write**:
- `src/routes/room/[id]/+page.svelte`

**Changes**:
- Wire CoachMarks `oncomplete` → set all banner suppression flags
- Wire MobileNav `onnavigate` → update `mobileView`
- Ensure Invite button visible in mobile header (keep it)
- Remove `.encryption-badge` and `.shield-badge` hiding from mobile CSS (already hidden, just verify)
- Adjust `.room` bottom padding on mobile to account for bottom nav height

### Wave 4: E2E Tests

**Agent**: sonnet (test logic)

**Files to write**:
- `tests/unit/coach-marks.test.ts`
- `tests/unit/mobile-nav.test.ts`

**Changes**:
- CoachMarks unit tests (dynamic steps, completion, storage)
- MobileNav unit tests (rendering, badges, navigation events)
- No new E2E tests needed — this is CSS/layout which Playwright can't easily verify headlessly on mobile viewports

## File Dependency Graph

```
Wave 1: CoachMarks.svelte ──→ +page.svelte (banner conditions)
Wave 2: MobileNav.svelte (new) ──→ +page.svelte (mobile layout)  [parallel with Wave 1]
Wave 3: +page.svelte (integration wiring)  [depends on Wave 1 + 2]
Wave 4: test files  [depends on Wave 1 + 2]
```

Waves 1 and 2 are parallel (different DOM regions, different CSS sections).
Wave 3 depends on both. Wave 4 depends on 1+2 (tests import components).

### Wave 0: Background Color Fix (trivial, no dependencies)

**Agent**: haiku (mechanical CSS)

**Files to write**:
- `src/theme.css`

**Changes**:
Add global `body` and `html` background rules using `--bg-base` token. This eliminates the white border visible in both light and dark modes on all pages.

```css
html, body {
    margin: 0;
    padding: 0;
    background: var(--bg-base);
}
```

This is a 3-line fix. No tests needed — it's a CSS reset.

## Risk Assessment

- **Low risk**: No crypto changes, no relay changes, no new dependencies
- **Mobile-only CSS**: Desktop layout completely unaffected
- **Backward compat**: Old `sessionStorage` keys still respected; new `localStorage` keys additive
- **CoachMarks storage migration**: Changing from `sessionStorage` to `localStorage` means users who saw the walkthrough in a previous session won't see it again (desired behavior)
