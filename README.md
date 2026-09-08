# Astralite — The Drowned Keep

An isometric browser dungeon crawler. Every run generates a fresh drowned
fortress: 16–23 freely-branching rooms of six footprint types, joined by
bent corridors, wooden bridges and shortcuts, populated with guards,
stalkers and wardens to cut down.

Built with React 19 RSC on [vinext](https://www.npmjs.com/package/vinext)
(Vite), rendered with Three.js, styled with Tailwind CSS v4.

## Play

The floor is generated from a seed at load, so a reload gives a new keep.

| Input | Action |
| --- | --- |
| `WASD` / arrow keys | Move (screen-relative) |
| Hold mouse / `Space` | Strike — held input repeats the swing |
| `Shift` | Dash, and cancel a committed attack |
| Touch | Drag to move, second finger to hold-strike |

Clearing every guard in a room cleanses it and restores health. Each guard is
worth 25 XP, awarded exactly once; XP is per-run and resets on retry.

## Layout

```
game/                    the application
  app/
    dungeon-game.tsx     game loop, input, combat, HUD
    dungeon-floor.ts     seeded procedural floor generator
    dungeon-atmosphere.ts  lighting, particles, props
    dungeon-audio.ts     ambient drone and combat sounds
  scripts/
    pages-relative-paths.mjs  rewrites the export for sub-path hosting
output/                  playtest artifacts: screenshots, replay JSON, dev scripts
```

`game/progress.md` is the running development log — what was changed, how it
was validated, and what remains.

## Develop

Requires Node.js 22.13 or newer.

```bash
cd game
npm install
npm run dev
```

Other scripts: `npm run build` (production build into `game/dist`),
`npm start` (serve the built worker via Wrangler), `npm run lint` (oxlint),
`npm run format` (oxfmt).

## Deploy

Pushing to `main` builds the static export and publishes it to GitHub Pages
via [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).

GitHub Pages serves the site from a repository sub-path, but the vinext export
writes root-absolute `/_next/...` asset URLs. `basePath` does not survive
`output: 'export'` in vinext (assets are emitted, HTML is not) and a relative
Vite `base` leaves the font URLs absolute, so the workflow post-processes the
build with `scripts/pages-relative-paths.mjs` instead. That script fails loudly
if the bundler output stops matching its expectations, rather than shipping a
silently broken page.

The project also carries its original Cloudflare Workers configuration
(`vite.config.ts`, `.openai/hosting.json`), which the Pages deployment does not
use.
