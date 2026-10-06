# SSH Visualization — Dev Context

## Dev workflow

Run checks on save (two separate terminals):
```bash
npm run test:watch      # jest in watch mode
npm run typecheck:watch # tsc --noEmit --watch
```

Pre-commit hook runs `npm run check` (jest + typecheck) automatically.

## Git hooks

Hooks live in `scripts/hooks/` and are committable. The `.git/hooks/pre-commit`
wrapper delegates to `scripts/hooks/pre-commit` so the canonical copy is in source
control.

Install/reinstall hooks: `sh scripts/setup-hooks.sh`
This also runs on `npm install` via the `postinstall` script.

## Reusing hooks in other projects

Copy `scripts/hooks/` and `scripts/setup-hooks.sh` into any project, then run
`sh scripts/setup-hooks.sh`. Adapt `scripts/hooks/pre-commit` to the new project's
check command.

For global hooks across ALL repos automatically:
```bash
mkdir -p ~/.githooks
cp scripts/hooks/pre-commit ~/.githooks/
# Make it detect JS projects dynamically:
# Replace `npm run check` with:
#   [ -f package.json ] && grep -q '"check"' package.json && npm run check
git config --global core.hooksPath ~/.githooks
```

## Stack

Next.js 14 App Router · React 18 · MUI v9 (Emotion, no styled-components) ·
Leaflet + custom VideoTileLayer (WebGL, WebCodecs) · TypeScript strict · Jest

SSR disabled for MapView (Leaflet is client-only): `dynamic(..., { ssr: false })`.
