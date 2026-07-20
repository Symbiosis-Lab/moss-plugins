# Changelog

All notable changes across all moss plugins are documented in this file. Per-plugin notes are tagged with the plugin name.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

_Pending publish with the next moss release._
- `[matters]` renamed collection folders are no longer re-created on every sync — collections now carry identity (known-id gate from plugin config, `syndicated:` collection-URL marker on new collection files, member-location placement for new articles); `parseFrontmatter` now reads moss-normalized (serde_yaml) frontmatter so stamped files keep their `syndicated:` identity. See [matters/CHANGELOG.md](./matters/CHANGELOG.md).
- `[matters]` `1.4.4`: permanently-dead image downloads (403/404/410) are memoized to `failed-media.json`; future builds skip them without a network attempt. Unavailable images surface in Matters settings instead of as repetitive advisory toasts. See [matters/CHANGELOG.md](./matters/CHANGELOG.md).
- `[matters]` `1.4.1`+ — local-first comments (`uid` contract, Artalk integration, tombstone reconcile), social data to `.moss/data/social/`, stranded-comment recovery, session-expiry/auth-routing hardening; quieter, recoverable login (cancel/fail returns to the editor) and homepage title from the vault folder name; plus a **standalone, reopenable login** (new `login` capability — connect from Settings or an unlogged preview without importing, auto-open-once with a dismiss latch, faster first cookie check, locale-aware success toast). See [matters/CHANGELOG.md](./matters/CHANGELOG.md).
- `[github]` `1.5.1`: deploy from the active build generation (`.moss/build/current` → `.moss/build/generations/<id>/`) instead of the now-permanently-empty `.moss/build/site/`; the generated GitHub Actions workflow uploads from `.moss/build/current`. Plus a README / public-mirror docs refresh. See [github/CHANGELOG.md](./github/CHANGELOG.md). (#816)

## 2026-06-11

**matters** bumped to `1.4.0`. See [matters/CHANGELOG.md](./matters/CHANGELOG.md) for full notes.
- `[matters]` Local-first comments: uid contract, Artalk server integration, tombstone reconcile.
- `[matters]` Social data written to `.moss/data/social/`; stranded-comment recovery.

## 2026-06-04

**matters** bumped to `1.2.0`. See [matters/CHANGELOG.md](./matters/CHANGELOG.md).
- `[matters]` Session-expiry handling (T1–T7): JWT decode, tri-state session, dead-token filter, trigger-aware auth routing.

## 2026-05-30

**matters** bumped to `1.1.2`.
- `[matters]` Reconcile manifest after QuickJS runtime upgrade.

## 2026-05-29 — Open-source release (npm publication pending)

All active plugins moved to the `Symbiosis-Lab/moss-plugins` public mirror and integrated into
the monorepo CI. npm publishing is manual (via `changesets-release` workflow dispatch) and
has not yet been triggered; see individual plugin CHANGELOGs for version history.

- `[github]` `@symbiosis-lab/moss-plugin-github@1.5.0` — deploy fixes, CI integration.
- `[matters]` `@symbiosis-lab/moss-plugin-matters@1.1.1` — rebuild fix, language-aware article folder.
- `[douban]` `@symbiosis-lab/moss-plugin-douban@0.1.0` — initial WIP release, moved to `WIP/`.
- `[linkedin]` `@symbiosis-lab/moss-plugin-linkedin@0.1.0` — initial WIP release, moved to `WIP/`.
- `[substack]` `@symbiosis-lab/moss-plugin-substack@0.1.0` — initial WIP release, moved to `WIP/`.
- `[x]` `@symbiosis-lab/moss-plugin-x@0.1.0` — initial WIP release, moved to `WIP/`.
- `[xiaohongshu]` `@symbiosis-lab/moss-plugin-xiaohongshu@0.1.0` — initial WIP release, moved to `WIP/`.
