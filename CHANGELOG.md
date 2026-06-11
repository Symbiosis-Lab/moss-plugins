# Changelog

All notable changes across all moss plugins are documented in this file. Per-plugin notes are tagged with the plugin name.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
