# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

_Pending publish — cumulative since `1.1.2` (last released on main); full detail under [1.4.0] and [1.2.0]._
- Fixed: images, covers, and audio now upload to Matters correctly. Assets are uploaded by **bytes** read from the local build output (multipart `singleFileUpload`), not by URL. Matters' server cannot reliably fetch assets by URL from a deployed site (Caddy/moss-seta hosts return `UNABLE_TO_UPLOAD_FROM_URL`), and `embedaudio` rejects url-upload entirely — so previously images often broke and audio never uploaded. On upload failure, image/audio srcs fall back to the absolutized deployed URL so they still display. Verified end-to-end against `server.matters.icu`.
- Fixed: audio embeds now syndicate to Matters at all. moss's `<audio class="moss-embed">` is rewritten into Matters' required `<figure class="audio">` shape (the only shape its sanitizer keeps; previously the entire `<audio>` was stripped to stray fallback text), then the audio bytes are uploaded via `embedaudio`.
- Local-first comments: `uid` contract, env-derived Artalk server URL, tombstone reconcile, morph-proof preview stub.
- Social data written to `.moss/data/social/`; stranded-comment recovery.
- Session-expiry handling: JWT decode, tri-state session, dead-token filter, trigger-aware auth routing, honest receipts.

## [1.4.0] - 2026-06-11

### Added
- Local-first comments integration: `uid` contract, env-derived Artalk server URL,
  tombstone reconcile, morph-proof preview stub.
- Social data written to `.moss/data/social/` alongside build; recovers stranded comments.
- Diagnostic advisories on hook-failure with full refetch on cleared counts.

### Fixed
- Full refetch on cleared platform counts to avoid stale display.

## [1.2.0] - 2026-06-04

### Added
- Session-expiry handling across 7 implementation tasks (T1–T7):
  - Decode JWT `exp` claim locally (T1).
  - Tri-state session check with dead-token filtering and persisted nudge stamp (T2).
  - Typed `MattersAuthError` from response bodies (T3).
  - Pure trigger-aware auth router (T4).
  - Trigger-aware auth routing, gated binding guard, honest receipts (T5).
  - Mid-sync auth failure copy and tri-state syndicate gate (T6).
  - Review fixes: cookie dead-token filter, `queryMode` reset, receipt copy (T6.5).
  - Reconciled plugin version after rebase (T7).
- `MOSS_MATTERS_DOMAIN` env var to switch test/prod domain in-webview.
- `MOSS_MATTERS_TEST_PROFILE` env var bypasses login in test builds.
- moss-injected trigger context; terminated leaked background tasks.

## [1.1.2] - 2026-05-30

### Changed
- Reconcile plugin manifest after QuickJS runtime upgrade in moss v0.7.x.

## [1.1.1] - 2026-05-29

### Fixed
- Rebuild bundled plugin correctly on release build (`cargo build --release`).
- Language-aware article folder (文章 for Chinese content).
- Convert HTML via moss's shared htmd converter.
- Emit filename-only wikilinks for assets.
- Trim tag whitespace; localize legacy non-UUID assets.
- Pre-merge review fixes: G runtime no-op, title wikilink, hairline clip.

### Added
- Generate self-named home article with `home: true` marker.
- Marker-aware home detection exposed to plugin-facing API.

## [0.0.2] - 2026-05-29

> **Note:** This npm publication was experimental. The plugin version lineage returned to
> 1.x after the open-source consolidation; `0.0.2` is documented here for history only
> and was never successfully published to npm.

Initial publication attempt under the `@symbiosis-lab` scope, bundled with the
open-source release pipeline.
