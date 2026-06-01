# moss-plugins

> Official moss publishing plugins.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> **Read-only mirror.** Source lives in the private moss monorepo. PRs cannot be merged here — see [CONTRIBUTING.md](CONTRIBUTING.md).

This repository contains the 7 official moss publishing plugins. Each subdirectory is an independently-publishable npm package under `@symbiosis-lab/moss-plugin-<name>`.

## Plugins

| Plugin | npm | Purpose |
|---|---|---|
| [github](./github) | [`@symbiosis-lab/moss-plugin-github`](https://www.npmjs.com/package/@symbiosis-lab/moss-plugin-github) | Publish moss sites to GitHub Pages |
| [matters](./matters) | [`@symbiosis-lab/moss-plugin-matters`](https://www.npmjs.com/package/@symbiosis-lab/moss-plugin-matters) | Publish posts to matters.town |
| [douban](./douban) | [`@symbiosis-lab/moss-plugin-douban`](https://www.npmjs.com/package/@symbiosis-lab/moss-plugin-douban) | Import and cross-post content from douban |
| [linkedin](./linkedin) | [`@symbiosis-lab/moss-plugin-linkedin`](https://www.npmjs.com/package/@symbiosis-lab/moss-plugin-linkedin) | Cross-post to LinkedIn |
| [substack](./substack) | [`@symbiosis-lab/moss-plugin-substack`](https://www.npmjs.com/package/@symbiosis-lab/moss-plugin-substack) | Cross-post to Substack |
| [x](./x) | [`@symbiosis-lab/moss-plugin-x`](https://www.npmjs.com/package/@symbiosis-lab/moss-plugin-x) | Cross-post to X |
| [xiaohongshu](./xiaohongshu) | [`@symbiosis-lab/moss-plugin-xiaohongshu`](https://www.npmjs.com/package/@symbiosis-lab/moss-plugin-xiaohongshu) | Cross-post to Xiaohongshu |

Archived (no longer maintained): `astro`, `eleventy`, `gatsby`, `hugo`, `jekyll` — see `archive/`.

## Stability

All plugins are 0.x. APIs may change between minor versions until 1.0. Each plugin tracks its own [CHANGELOG](./CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
