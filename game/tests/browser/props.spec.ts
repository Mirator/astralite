import { canStand, dealRewards, generateFloor } from '../../app/dungeon-floor.ts';
import { swordContacts } from '../../app/dungeon-combat.ts';
import { furnishFloor } from '../../app/dungeon-furnish.ts';
import { wavedFloor } from '../../app/dungeon-waves.ts';
import { ARROW_KEYS, expect, SCREEN_DIRECTIONS, swing, test, TILE, type ScreenDirection } from './helpers.ts';

// Plan 025 Stage F (D12 a): the furniture as the running game plays it. What a prop does is held in node (tests/dungeon-props.test.ts, tests/dungeon-furnish.test.ts); this holds that
// the game is wired to it: the floor it builds carries the furniture, a real sword swing finds an urn by the rule a body is found by, and the scene stops drawing what broke. The harness
// boots every page with `?rooms=plain` (helpers.ts `DEFAULT_ROOMS`), so this asks for the keep as it ships and has a page of its own.

test.describe('the furniture', () => {
  // Seed 0x1's floor one holds a Stillwater Shrine (room 5) with an urn in it: a chamber with nobody in it, so nothing but the swing moves the urn.
  test.use({ rooms: null, seeds: [0x1] });
  test('a real sword swing breaks an urn, the scene stops drawing it, and the swing leaves the rest of the chamber standing', async ({ game, page }) => {
    await game.enter();
    const state = await game.state();
    expect(state.floor.level).toBe(1);
    // Laid as the game lays it, for planning the stance only (cells without the cover tiles); everything asserted below is read off the scene. The harness's `?waves=off` deals no later
    // wave, so no wave's spawn tiles are kept clear of furniture either.
    const generated = generateFloor(state.floor.seed, 1), waved = game.waves === null ? wavedFloor(generated, state.floor.seed, 1) : generated;
    const laid = furnishFloor(dealRewards(waved, state.floor.seed, 1), state.floor.seed, 1);
    const room = laid.rooms.find((r) => r.encounter === 'sanctuary' && r.id !== 0 && laid.furniture.some((p) => p.room === r.id && p.kind === 'urn'));
    expect(room, 'seed 0x1 floor one no longer holds a shrine with an urn in it: pick another seed').toBeDefined();
    expect(state.furniture.total, 'the floor the game built carries no furniture: `?rooms=` is not reaching it, or the build does not lay it').toBe(laid.furniture.length);

    await game.teleport(room!.entry.x * TILE, room!.entry.z * TILE);
    await game.step(100);
    const inside = await game.state();
    expect(inside.chamber.id, 'precondition: the knight is in the shrine').toBe(room!.id);
    const urn = inside.furniture.here.find((p) => p.kind === 'urn');
    expect(urn, 'the scene holds no urn in the shrine the floor laid one in').toBeDefined();
    expect(urn!.shown && !urn!.broken, 'precondition: the urn stands and is drawn').toBe(true);
    const standing = inside.furniture.here.filter((p) => p.id !== urn!.id && p.kind !== 'cover');

    // A tile beside the urn to swing from: a screen direction the arrow keys aim, with the urn inside that swing's arc by the production contact rule.
    let stance: { x: number; z: number; key: string } | null = null;
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const at = { x: urn!.x + dx * TILE * .7, z: urn!.z + dz * TILE * .7 };
      if (!canStand(laid.cells, at.x, at.z)) continue;
      const name = (Object.keys(SCREEN_DIRECTIONS) as ScreenDirection[]).find((n) => swordContacts(laid.cells, at, SCREEN_DIRECTIONS[n], urn!, 0));
      if (name && standing.every((p) => !swordContacts(laid.cells, at, SCREEN_DIRECTIONS[name], p, 0))) { stance = { ...at, key: ARROW_KEYS[name] }; break; }
    }
    expect(stance, 'no tile beside the urn swings at it and at nothing else').not.toBeNull();
    await game.teleport(stance!.x, stance!.z);
    await game.step(50);
    const ready = await game.state();
    expect(ready.furniture.here.find((p) => p.id === urn!.id)!.broken, 'precondition: walking up to the urn broke it').toBe(false);

    await swing(page, stance!.key);
    await game.step(500);
    const after = await game.state();
    const struck = after.furniture.here.find((p) => p.id === urn!.id)!;
    expect(struck.broken, 'a real swing at the urn did not break it').toBe(true);
    expect(struck.shown, 'the urn broke but the scene still draws it').toBe(false);
    for (const p of standing) expect(after.furniture.here.find((q) => q.id === p.id)!.broken, `the swing broke the ${p.kind} it was not aimed at`).toBe(false);
    // Cover is solid where it stands: the step, the lane and the bolt all read `cells`.
    for (const p of after.furniture.here.filter((q) => q.kind === 'cover')) expect(p.solid, 'a cover block the knight can walk through').toBe(true);
  });
});
