## 2026-10-06

Task: Match the default This computer / Cloud appearance to the project control

Changed:
- apps/desktop/src/pages/sessions.css: remove the location-specific default
  background. Location controls inherit the project's transparent background and
  subdued text; hover/open feedback uses the same subtle mix.
- docs/desktop/README.md: describe transparent default controls.

Why:
- User clarified that location controls should have no default highlighted pill.

Tests:
- npm run build: PASS (existing large-bundle warning).
- git diff --check: PASS.

No behavior changes, commit, release or installed-app replacement.
