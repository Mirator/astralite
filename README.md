# Astralite — The Drowned Keep

An isometric browser dungeon crawler. Every run generates a fresh drowned
fortress: three floors, each 10–25 freely-branching rooms of six footprint
types, each its own island joined to the next by a door that opens once the
chamber is clear (there are no corridors or bridges), populated with guards,
stalkers and wardens to cut down (in waves, with elites from floor two, and no
healing for clearing a chamber), and ended by a boss at the stair of each floor.

Built with React 19 RSC on [vinext](https://www.npmjs.com/package/vinext)
(Vite), rendered with Three.js, styled with Tailwind CSS v4.

## Play

ENTER THE KEEP opens three save slots (each keeps its own pearls, arms and run
log; a save from before slots arrives in slot 1). Choosing one wakes you in the
Tide Altar's hall: the altar spends pearls, a rack for every unlocked arm lets
you choose one (walk into its ring and press the swap key), and the door in the
far wall, the way down, settles the arm and starts the descent. Each floor is
generated from its own seed, so every descent is a new keep.

Every key below is a default and can be rebound in the pause menu; `Esc` always
opens that menu whatever else it is set to, so a rebind cannot lock you out.

| Input | Action |
| --- | --- |
| `WASD` / arrow keys | Move (screen-relative) |
| `Space` | Strike — held input repeats the swing |
| `Shift` | Dash. It aborts a swing before or after the blade is live; while the blade is live it waits for contact to end |
| `Esc` / `M` / `F` | Pause, mute, fullscreen |
| Touch | Thumbstick, DASH and STRIKE buttons; labelled direction buttons are the alternative touch layout |

The same menu carries a volume slider and a motion setting that defaults to the
system's `prefers-reduced-motion` and can be overridden either way. Reduced
motion drops the camera shake and holds the hurt tint still; it does not touch
hit-stop, which is timing the fight depends on. All of it is remembered locally.

Clearing every guard in a room cleanses it and restores health. Each guard is
worth 25 XP, awarded exactly once; XP is per-run and resets on retry. Floor
one's seed is kept in the run log, and the deepest descent survives a reload.

A run that ends, won or lost, banks pearls (2 for each fight chamber cleared, 10 for
each boss, 15 a floor behind you, 25 for escaping). The result card, won or lost, has one button, RETURN TO
THE ALTAR, which takes you back to the hall; the **Tide Altar** there spends the
pearls: it unlocks the six arms beyond the Tideblade and sells four small
upgrades. Pearls and purchases are kept in the browser, per slot. The arm is
chosen on the racks of the hall, where every unlocked arm stands on a rack, and
the way down locks the choice for that descent. No chamber holds an arm.
Everything the Altar sells costs 900 pearls in all. The hall's pause menu has
LEAVE TO TITLE, which returns to the slot picker.

## Layout

```
game/                    the application
  app/
    dungeon-game.tsx     the world closure (game loop, combat, HUD) and when each rule is asked
    dungeon-player.ts    the knight's swing, chain, dash, input buffers and hit-stop
    dungeon-input.ts     what a key, a pad, the cursor or an action event asks for
    dungeon-floor-scene.ts  raising a generated floor into the scene
    dungeon-enemy-view.ts  building a skeleton and drawing its marks and decisions
    dungeon-test-hooks.ts  the dev-only diagnostics behind window.dungeonTest
    dungeon-combat.ts    pure sword-contact and damage-rounding rules
    dungeon-floor.ts     seeded procedural floor generator
    dungeon-sim.ts       vitality, XP, ranks, boons, damage rules
    dungeon-save.ts      best run, seed, run log, settings and the pearl save in localStorage
    dungeon-meta.ts      pearls, upgrades and unlocked arms: earning, buying, what a run starts with
    dungeon-atmosphere.ts  lighting, particles, props
    dungeon-motion.ts    water and stone shaders, cloth motion
    dungeon-audio.ts     ambient drone and combat sounds
  scripts/
    pages-relative-paths.mjs  rewrites the export for sub-path hosting
  tests/                 node suite over the pure modules
    browser/             Playwright scenarios over the running game
output/                  playtest artifacts: replay JSON and the dev scripts
```

`game/progress.md` is the running development log — what was changed, how it
was validated, and what remains. `game/tests/README.md` covers the node suite
and the browser hooks a driver can steer a run with.

## Develop

Requires Node.js 22.13 or newer.

```bash
cd game
npm install
npm run dev
```

Other scripts: `npm run build` (production build into `game/dist`),
`npm start` (serve the built worker via Wrangler), `npm test` (the node
suite), `npm run lint` (oxlint), `npm run format` (oxfmt).

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
