# 014 — Reach the reference image's level of detail

Reference: `C:\Users\MIROSL~1\AppData\Local\Temp\claude\C--Users-Miroslav-Pavelek-Documents-astralite\31407f39-96f4-46cc-8d40-49efb4eba68c\scratchpad\ref\reference.png`
(1672x941, painted isometric concept art: knight slashing skeletons on a wet stone bridge over glowing
turquoise water, torches and violet braziers, heavy vignette, dark foreground silhouettes).

Scope rule for this plan: **performance budgets and the graphics/pixel tests are out of scope** (the
user said to ignore them). The game must still boot, play and pass `npm run typecheck`. Do not commit,
push or deploy. Work on branch `feat/reference-art` in the main checkout.

## Gap analysis (current baseline vs reference)

| Aspect | Reference | Current |
| --- | --- | --- |
| Framing | Close: knight ~1/9 of screen height, scene fills frame | Far: knight ~1/14, lots of empty floor/water |
| Light | Near-black ambient, pools of warm torchlight, violet braziers, cyan water uplight, high contrast | Flat moonlight, even exposure, low contrast |
| Post | Bloom on flames, teal/orange grade, heavy vignette, blurred dark edges (tilt-shift) | None (straight render + ACES) |
| Floor | Wet dark flagstones, specular sheen, grime, cracks, blood splatter | Clean teal tiles, flat |
| Walls | Chunky irregular bevelled blocks, broken crenellations, arches, pillars with red banners | Neat low parapets |
| Water | Glowing turquoise, caustics, visible sunken ruins, fish | Dark blue with streaks |
| Props | Urns, chains, violet braziers, torches, stairs, statue | Sparse |
| Figures | Dark outline, glowing yellow eyes, red `!` alerts, red ground telegraphs | Pale, low contrast against floor |
| Foreground | Out-of-focus black silhouettes (statue, foliage, chains) framing corners | None |
| HUD | Diamond-framed serif title + italic subtitle, ornate bar | Mono text, plain bars |

## Levers, highest impact first

1. **Screenshot harness first.** `game/scripts/reference-shot.ts` (Playwright, d3d11 GL, own port e.g.
   3100 via `GAME_TEST_PORT`, 1672x941 viewport). Boots, enters the keep, builds a floor that has a
   bridge over water, places the knight on it with 3+ awake enemies around, freezes time with
   `advanceTime`, triggers a swing, and writes 3 PNGs — `combat-bridge.png`, `torch-room.png`,
   `corridor.png` — into a directory given as CLI arg. Every later round uses it unchanged, so the
   critic compares like with like.
2. **Camera.** Zoom in (`span` in `resize` from 7.2 → ~4.3; phone value proportionally), keep the
   iso angle. Re-check aim (`dungeon-aim.ts`) still maps pointer correctly.
3. **Post-processing.** `EffectComposer` → `RenderPass` → `GTAOPass` (crevice darkening) →
   `UnrealBloomPass` (threshold so only flames/emissive/eyes bloom) → custom grade `ShaderPass`
   (lift shadows toward teal, highlights toward orange, contrast up, saturation up slightly,
   strong radial vignette, tilt-shift blur on top/bottom ~20%, faint grain) → `OutputPass`.
   Move tone mapping into the OutputPass path correctly.
4. **Lighting.** Hemisphere ~0.12, moon weaker and cooler; torches as strong warm point lights with
   physical decay; add violet brazier lights; cyan uplight near water edges. Shadow map 4096, soft.
   PMREM environment (small generated room with bright emissive cards) at low `envMapIntensity` so
   wet surfaces catch highlights.
5. **Wet floor.** Darker, desaturated flagstones with per-tile tone variation, deep grout, procedural
   roughness map (puddle patches ~0.15 vs stone ~0.7), crack/grime decals, blood splat decals on hits
   and deaths (they persist for the floor).
6. **Walls & structure.** Parapets built from irregular bevelled blocks (random size/height jitter,
   missing/broken merlons), square pillars with caps at intervals carrying red banners with a sigil,
   arches under bridge spans visible over the water, moss/vine patches.
7. **Water.** Shader: deep teal base, bright animated caustic network (voronoi), depth fade, emissive
   so it lights the scene; dim sunken block ruins below the surface; a few drifting fish silhouettes;
   foam line at contact with stone.
8. **Props.** Urn/pot clusters by walls, hanging chains, violet-flame braziers on stone plinths,
   wall torches, occasional stair flights.
9. **Figures.** Inverted-hull dark outlines on knight and enemies; emissive yellow-orange eyes on
   skeletons (bloom picks them up); red `!` alert glyph above newly awake enemies; red translucent
   ground telegraph decals with a rune pattern; brighter, wider slash arc with bloom; blood spray
   particles on hit.
10. **Foreground framing.** Dark, blurred silhouettes in the corners (statue with spear bottom-left,
    foliage/chains right) — a pointer-events-none overlay layer; must not cover HUD or centre.
11. **HUD restyle (no new persistent widgets beyond what exists).** Serif display font, diamond-framed
    floor title with italic objective subtitle, ornate health bar with diamond emblem.

## Verification per round

`npm run typecheck`, the game boots with no console errors, the knight can move/attack, then the
harness writes the 3 PNGs. Ignore frame budget, pixel-diff and art-direction tests.
