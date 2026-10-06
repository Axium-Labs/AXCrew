## 2026-10-06 16:28

Task: Unified model controls, responsive layout, retained drafts and turn navigation

Changed:
- ModelControls.tsx/modelControls.ts: one compact model/effort trigger and a
  combined Fast/model/stepped 思考强度 panel, with no default/reset controls.
  Only the selected catalogue's effort subset is offered; configured/catalogue
  defaults are respected and stale choices fall back to a supported value.
- lib/ax.ts, lib/types.ts and src-tauri/src/ax.rs: retain provider effort metadata
  and selected configured effort through the desktop bridge.
- SessionsWorkspace.tsx and api/sessions.rs: forward effort on follow-ups as well
  as first turns; keep paired-host and local-SSH model catalogues distinct.
- store/sessions.ts: persist text drafts; distinguish new, local and branch keys,
  preserve newest text when turn IDs resolve to a canonical conversation, and
  clear only the accepted send's draft. Image attachments remain in memory.
- TurnNavigator.tsx, sessionTranscript.ts and SessionTranscript.tsx: stable turn
  markers, request/answer hover or focus preview, click-to-scroll and active mark.
- App.tsx, scale.ts, styles.css, sessions.css, settings.css, tauri.conf.json:
  native zoom 1, responsive navigation/panes/settings, bounded popup, 640x480
  native minimum. Narrow navigation remains manually accessible and saved large
  window preferences are preserved.
- New regression files under tests/desktop and tests/session_effort.rs; existing
  shell/cloud model interaction tests updated for the unified panel.
- Desktop/development/API docs synchronized. AX provider enum preserves wire
  effort values (see AX log); website has no specific effort/UI claim to update.

Why:
- User requested Codex-style consolidated controls, real provider effort levels,
  normal sizes on smaller monitors, no lost input on chat switching and a turn rail.
- The previous scaling logic captured monitor DPI once and enlarged by width;
  the previous bridge discarded capabilities and follow-ups discarded effort.

Tests:
- Full UI suite: 133 passed / 26 files.
- Desktop TypeScript/Vite build: PASS (existing large-bundle warning).
- Composer browser suite: 6 passed; model/configured-default and minimum-size
  cases rerun after final changes: PASS. Desktop/HiDPI, 960/760/560 CSS width and
  640x480 minimum, chat switching/reload, late binding, preview/jump, Fast and
  follow-up payload covered. Screenshots reviewed under ignored test-results.
- Existing transcript suite: 10 passed; connections/project/cloud suite: 5 passed;
  shell Fast/highlight regression: 2 passed. 23 distinct browser cases total.
- Gateway follow-up effort request/input test: PASS.
- Tauri catalogue metadata/legacy compatibility test: PASS; native zoom/DPI
  reset mock test: PASS in UI suite.
- AX catalogue tests: 2 passed; model selection tests: 10 passed; cargo check
  -p cli: PASS. Both repositories' diff whitespace checks: PASS.

Limits:
- Catalogue support/defaults come from AX discovery/cache. Models that provide
  no effort choices show an unavailable explanation instead of invented levels.
- Branch context and image attachments are in memory; persisted ordinary text
  drafts do not restore those objects after closing the app.
- Browser DPI tests and native zoom mocks passed; a physical cross-monitor drag
  of a rebuilt installed app was not performed.

No release, commit or installed-app replacement. Other uncommitted work retained.
