# ReoxMySQL — Development

## Prerequisites

- [Bun](https://bun.sh/) runtime
- Node.js 22+ (for FiveM CJS target compatibility)

```bash
# 1. Install dependencies (use bun, not npm/yarn/pnpm)
bun install

# 2. Build (bundles src/ via esbuild + compiles lib/ via tsc)
bun run build

# 3. Build with watch mode during development
bun run watch
```

## Release

```bash
bun run release
```

This runs `build` then creates a release package via `scripts/create-release.js`.

## Build Output

| Output                            | Purpose                                               |
| --------------------------------- | ----------------------------------------------------- |
| `dist/build.js`                   | FiveM server script entry point (CJS, Node 22 target) |
| `lib/MySQL.js` + `lib/MySQL.d.ts` | Lua-callable library exports (TypeScript)             |

Only `build.js` / `dist/` needs rebuilding for server-side changes. `lib/` is the public TypeScript API.

## Notes

- All `src/` imports resolve from `src/` via `tsconfig.json` path aliases — no `../` chains needed.
- esbuild resolves these via bundler resolution.
- Patches are applied automatically via `patch-package` during `postinstall`.
