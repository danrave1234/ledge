# Changelog

All notable changes are documented here. Perch follows Semantic Versioning once
it reaches its first stable release.

## 0.1.1 - 2026-08-21

- Added the optional Computer control plugin for approval-gated text insertion
  into the last focused Windows app. Perch previews the exact target and text;
  insertion itself never submits, sends, or uploads anything.
- Added approval-gated browser navigation. Perch previews the exact HTTP(S)
  address, revalidates the previously focused supported browser, and navigates
  only after the user presses Open.
- Added approval-gated visual action plans for clicks, text, common navigation keys,
  and scrolling. Plans are bounded, shown step-by-step, and tied to the exact last
  focused window; sensitive and arbitrary keyboard actions remain unavailable.
- Kept the widget expanded while its chat input or another control has focus,
  with normal auto-hide resuming after both pointer and focus leave.
- Made independent tool calls execute concurrently while preserving model-visible
  result order, and required supported action requests to create their approval UI.
- Improved native failure diagnostics and made storage reads distinguish missing
  files from permission, corruption, and other filesystem errors.
- Made Web, Screen, and Music consent strictly per-message.
- Added show-before-send screen previews and local image redaction.
- Moved conversation images into bounded app-data assets.
- Migrated OpenAI streaming to the Responses API and request-scoped cancellation.
- Added CSP hardening, accessibility semantics, dependency automation, E2E checks,
  signed GitHub release/update automation, and project governance documents.
