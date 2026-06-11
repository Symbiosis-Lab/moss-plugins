# moss-plugins

> Official moss publishing plugins.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> **Read-only mirror.** Source lives in the private moss monorepo. PRs cannot be merged here — see [CONTRIBUTING.md](CONTRIBUTING.md).

This repository contains the official moss publishing plugins. Plugins are bundled with the moss app — there is no separate npm install step for end users. Each subdirectory is an independently-versioned package under `@symbiosis-lab/moss-plugin-<name>`; npm publishing is manual and in progress.

## Active plugins

| Plugin | Package | Purpose |
|---|---|---|
| [github](./github) | `@symbiosis-lab/moss-plugin-github` | Publish moss sites to GitHub Pages |
| [matters](./matters) | `@symbiosis-lab/moss-plugin-matters` | Publish posts to matters.town |

## In development (WIP)

These plugins are functional but not yet recommended for general use.

| Plugin | Package | Purpose |
|---|---|---|
| [douban](./WIP/douban) | `@symbiosis-lab/moss-plugin-douban` | Import and cross-post content from douban |
| [linkedin](./WIP/linkedin) | `@symbiosis-lab/moss-plugin-linkedin` | Cross-post to LinkedIn |
| [substack](./WIP/substack) | `@symbiosis-lab/moss-plugin-substack` | Cross-post to Substack |
| [x](./WIP/x) | `@symbiosis-lab/moss-plugin-x` | Cross-post to X |
| [xiaohongshu](./WIP/xiaohongshu) | `@symbiosis-lab/moss-plugin-xiaohongshu` | Cross-post to Xiaohongshu |

Archived (no longer maintained): `astro`, `eleventy`, `gatsby`, `hugo`, `jekyll` — see `archive/`.

## Stability

All plugins are 0.x. APIs may change between minor versions until 1.0. Each plugin tracks its own [CHANGELOG](./CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
