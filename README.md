# moss-plugins

[![Test](https://github.com/Symbiosis-Lab/moss-plugins/actions/workflows/test.yml/badge.svg)](https://github.com/Symbiosis-Lab/moss-plugins/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/Symbiosis-Lab/moss-plugins/graph/badge.svg)](https://codecov.io/gh/Symbiosis-Lab/moss-plugins)

Plugins for [moss](https://github.com/Symbiosis-Lab/moss).

## Plugins

| Plugin | Capability | Description |
| ------ | ---------- | ----------- |
| [github](github) | Deploy | Deploy to GitHub Pages |
| [matters](matters) | Syndicate | Syndicate to Matters.town |

## Development

### Structure

```
moss-plugins/
├── github/
│   ├── package.json
│   ├── src/
│   ├── dist/
│   └── manifest.json
├── matters/
│   ├── package.json
│   ├── src/
│   ├── dist/
│   └── manifest.json
├── .github/workflows/
│   ├── test.yml           # Run tests on PR/push
│   └── release-plugin.yml # Build & release on tag
└── codecov.yml
```

### Local Development

For hot reload testing with symlinks:

```bash
# In moss repo, bundled-plugins/ contains symlinks to plugin dist folders
# Changes to plugin source are immediately available after rebuild

cd github
npm run dev  # Watch mode - rebuilds on change
```

### Testing

```bash
# Test a specific plugin
cd github
npm test

# Test with coverage
npm run test:coverage
```

### Releasing

Each plugin is versioned independently. To release:

```bash
# Update version in package.json/Cargo.toml
# Commit changes
git tag github-v1.0.0
git push origin github-v1.0.0
```

The CI will automatically build and create a GitHub release.

## Plugin Types

### JavaScript Plugins

- Use TypeScript/JavaScript
- Built with esbuild
- Output: `dist/main.bundle.js` + `manifest.json`

### Binary Plugins (Rust)

- Use Rust
- Built for multiple platforms (macOS, Windows, Linux)
- Output: platform-specific binaries + `manifest.json`

## License

MIT
