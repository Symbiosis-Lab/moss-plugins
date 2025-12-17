# moss-plugins

[![Test](https://github.com/Symbiosis-Lab/moss-plugins/actions/workflows/test.yml/badge.svg)](https://github.com/Symbiosis-Lab/moss-plugins/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/Symbiosis-Lab/moss-plugins/graph/badge.svg)](https://codecov.io/gh/Symbiosis-Lab/moss-plugins)

Plugins for [moss](https://github.com/Symbiosis-Lab/moss).

## Plugins

| Plugin | Category | Description |
| ------ | -------- | ----------- |
| [github-deployer](github-deployer) | Deployer | Deploy to GitHub Pages |
| [matters-syndicator](matters-syndicator) | Syndicator | Syndicate to Matters.town |

## Development

### Structure

```
moss-plugins/
├── github-deployer/
│   ├── package.json
│   ├── src/
│   ├── dist/
│   └── manifest.json
├── matters-syndicator/
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

cd github-deployer
npm run dev  # Watch mode - rebuilds on change
```

### Testing

```bash
# Test a specific plugin
cd github-deployer
npm test

# Test with coverage
npm run test:coverage
```

### Releasing

Each plugin is versioned independently. To release:

```bash
# Update version in package.json/Cargo.toml
# Commit changes
git tag github-deployer-v1.0.0
git push origin github-deployer-v1.0.0
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
