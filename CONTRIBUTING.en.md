# Contributing

Thanks for your interest in contributing to **Tianshu-Canvas**.
中文版：[CONTRIBUTING.md](CONTRIBUTING.md).

## Requirements

- Node.js >= 24 (see `engines` in `package.json`)
- Optional: Chrome or Edge installed, for PNG export and browser end-to-end tests

## Local development

```bash
npm install
npm run verify   # typecheck + build + test
```

`verify` is the full gate that must pass before committing:

- `npm run typecheck`: type checks for both the Node and web sides
- `npm run build`: esbuild bundling, output written to `dist/`
- `npm test`: `node:test` contract / project / server / selection / export / probe e2e tests
  (they run against the **build output**)

Browser end-to-end verification:

```bash
npm run build
node scripts/verify-web.mjs            # auto-detects Chrome/Edge
node scripts/verify-web.mjs <chrome.exe>
```

## Layout

| Path | Description |
|---|---|
| `src/` | Node side (entry / tools / local server / project model / probe / export) → `dist/index.js` |
| `web/` | Canvas frontend (React + React Flow) → `dist/web/canvas.js` |
| `dist/` | Build output (**must be committed**) |
| `test/` | Tests (run against the build output) |
| `scripts/` | Build and verification scripts |
| `release/` | Per-version release notes |

## Important conventions

1. **`dist/` must be committed together with the source.** Tianshu installs plugins with
   `npm install --ignore-scripts --omit=dev` and **never runs build scripts**, so the build
   output must ship with the repository. CI verifies consistency with
   `git diff --exit-code -- dist`; always run `npm run build` and commit `dist/` after
   changing source.
2. **Keep the Node side a single-file bundle.** `src/server.ts` is a module-level singleton;
   splitting it into multiple files would inline a second singleton into the entry, making
   tests and runtime behave differently.
3. **Always use SVG icons, never emoji.**
4. **Commit messages are written in Chinese**, briefly explaining the "why".
5. This repository commits and pushes only to the `main` branch.

## Pull requests

1. Fork the repository and work on your branch.
2. Make sure `npm run verify` passes and that `dist/` is updated and committed.
3. Open a PR and fill in the verification details per the PR template.

## Release process (maintainers)

1. Update `CHANGELOG.md` and add `release/release-<version>.md` with the detailed notes.
2. Bump the version in `package.json` and `tianshu.plugin.json`.
3. Commit and push `main`, and make sure CI is green.
4. Push a tag (e.g. `v0.2.4`) to trigger `.github/workflows/release.yml`, which creates the
   GitHub Release.

## Security

Please do not report security vulnerabilities in public issues; see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are released under the [MIT](LICENSE) license.
