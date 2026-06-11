# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.5.0] - 2026-04-20

### Changed
- Open-source release: source moved to public mirror at Symbiosis-Lab/moss-plugins.
- CI integration via `pnpm test-plugins` in the monorepo test suite.

### Fixed
- Deploy pushes from `.moss/build/site/` (not stale `.moss/site/`).
- Deploy heartbeat re-emits last known step instead of hardcoded progress value.
- Remove `index.lock` before write-tree to handle iCloud re-locking race.
- `.moss/.gitignore` ownership moved into the moss-managed `.gitignore` (not plugin-owned).
- Resolve 240+ Dependabot security alerts in transitive dependencies.
