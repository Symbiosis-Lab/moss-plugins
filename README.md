# moss-plugins

> Plugins for [moss](https://mosspub.com) — and the registry that distributes them.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

This repository holds the source of every published moss plugin, first-party and
community alike, plus the registry metadata the moss app reads to offer them.
**Pull requests are welcome** — see [CONTRIBUTING.md](CONTRIBUTING.md).

> Previously this repo was a read-only mirror, generated from the moss monorepo
> and force-pushed on each sync — which is why older docs said PRs could not be
> merged. That is no longer true: this repo is now the source of truth for
> plugin code.

## How distribution works

A plugin is a TypeScript package bundled by esbuild into a single IIFE that moss
loads in a sandboxed QuickJS engine. End users do **not** install plugins from
npm.

1. You open a PR adding or updating a plugin directory.
2. CI validates it and builds the bundle from your source.
3. A maintainer reviews that source and merges.
4. On merge, CI packages `<id>-<version>.zip`, attaches it to a GitHub Release,
   and regenerates the registry index.
5. moss reads that index so users can install the plugin from the app, and shows
   an update badge when a newer version is published.

Updates are never applied silently — the user chooses when to update. If a
version turns out to be harmful it can be revoked via
[`registry/revoked.json`](registry/revoked.json), which moss honours on its next
refresh.

The in-app catalog that consumes this index ships in an upcoming moss release.
Until then, a published plugin can be installed by unpacking its release zip into
a project's `.moss/plugins/<id>/`.

## Active plugins

| Plugin | Package | Purpose |
|---|---|---|
| [github](./github) | `@symbiosis-lab/moss-plugin-github` | Publish moss sites to GitHub Pages |
| [matters](./matters) | `@symbiosis-lab/moss-plugin-matters` | Publish posts to matters.town |

## In development (WIP)

Functional but not yet recommended for general use.

| Plugin | Package | Purpose |
|---|---|---|
| [douban](./WIP/douban) | `@symbiosis-lab/moss-plugin-douban` | Import and cross-post content from douban |
| [linkedin](./WIP/linkedin) | `@symbiosis-lab/moss-plugin-linkedin` | Cross-post to LinkedIn |
| [substack](./WIP/substack) | `@symbiosis-lab/moss-plugin-substack` | Cross-post to Substack |
| [x](./WIP/x) | `@symbiosis-lab/moss-plugin-x` | Cross-post to X |
| [xiaohongshu](./WIP/xiaohongshu) | `@symbiosis-lab/moss-plugin-xiaohongshu` | Cross-post to Xiaohongshu |

`terrarium` is an internal harness for exercising moss's plugin UI surfaces, not
a user-facing plugin.

Archived (no longer maintained): `astro`, `eleventy`, `gatsby`, `hugo`, `jekyll`
— see [`archive/`](./archive).

## Repository layout

```
<plugin>/            a published plugin
  src/               TypeScript source — this is what reviewers read
  assets/            manifest.json + icon, copied verbatim into the bundle
  package.json       standalone; pins @symbiosis-lab/moss-api, own lockfile
  dist/              build output — gitignored; CI builds it from src/
registry/
  revoked.json       versions moss must refuse to load (the kill switch)
WIP/, archive/       not published to the registry
```

`dist/` is never committed. The artifact users install is always built by CI from
the source in the pull request, so what a reviewer reads is what ships.

Each plugin is an independent package with its own `package.json` and
`package-lock.json` — there is no workspace, so a PR only ever touches its own
dependency tree.

## Building a plugin locally

```bash
cd <plugin>
npm ci
npm run build      # bundles src/ -> dist/main.bundle.js and copies assets
npm test
npm run dev        # rebuild on change, for live development against moss
```

## Stability

All plugins are 0.x and track the moss plugin API, which may change between
minor versions until 1.0. Each plugin has its own `CHANGELOG.md`; declare the
oldest moss you support with `min_moss_version` in your manifest.

## License

MIT — see [LICENSE](LICENSE). Contributions are accepted under the same license.
