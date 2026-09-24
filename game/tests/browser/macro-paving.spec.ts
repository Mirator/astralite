import { planPavingPatches } from '../../app/dungeon-paving-layout.ts';
import { expect, Game, roomCentre, test, TILE, type Floor } from './helpers.ts';

/**
 * Plan 006's macro paving: merged two-cell slabs and settled, staggered strips. This checks the real
 * scene rather than the pure planner a second time - `dungeon-paving-layout.test.ts` covers
 * `planPavingPatches` in isolation (and `dungeon-paving-patches.test.ts` the slab's face winding) - so
 * what is worth asking here is whether `dungeon-game.tsx` actually wired the two together: the live
 * `graphics.paving` counters against the planner, in every theme. Collision is `canStand` over cells,
 * which paving never touches, so walking or striking across a slab needs no scenario of its own; add
 * one back if slabs ever become physical. The rest of the file stages review frames (`@capture`).
 */

/** What every scene gets before its first frame: torches lit, water moving. */
const SETTLE = 640;

/** Seed 0x5d (93 decimal), level 1: realizes a pair and a settled single in all three themes at once. */
const FIXTURE_SEED = 0x5d;

/** Holds every live enemy off cooldown, so a capture meant to show paving does not instead catch a windup. */
const freezeCombat = async (game: Game) => {
  const state = await game.state();
  await game.configureCombat({
    enemies: state.enemies.map((_, index) => ({ index, cooldown: 999, windup: 0 })),
  });
  await game.step(16);
};

/** A room that actually realized a pair of this theme, read off the pure planner for the given floor. */
const pairRoom = (floor: Floor, theme: 'keep' | 'ruins' | 'flooded') => {
  const pair = planPavingPatches(floor).pairs.find((p) => p.theme === theme);
  return pair ? floor.rooms[pair.room] : undefined;
};

test.describe('macro paving matches the pure planner', () => {
  test.use({ seeds: [FIXTURE_SEED] });

  test('the live scene realizes exactly what the planner plans, in every theme, with a non-empty surface index', async ({ game }) => {
    test.slow();
    await game.enter();
    const floor = await game.floor();
    const plan = planPavingPatches(floor);
    await game.step(SETTLE);
    const state = await game.state();

    expect(state.graphics.paving.pairs, 'realized pair count does not match the pure planner').toBe(plan.pairs.length);
    expect(state.graphics.paving.settled, 'realized settled count does not match the pure planner').toBe(plan.settled.length);
    expect(state.graphics.paving.surfaceCells, 'the surface index built no cells at all').toBeGreaterThan(0);
    expect(plan.pairs.length, `seed 0x${FIXTURE_SEED.toString(16)} no longer plans any pair; pick a new fixture seed`).toBeGreaterThan(0);
    expect(plan.settled.length, `seed 0x${FIXTURE_SEED.toString(16)} no longer plans any settled single; pick a new fixture seed`).toBeGreaterThan(0);

    const pairThemes = new Set(plan.pairs.map((p) => p.theme));
    expect([...pairThemes].sort(), 'fixture floor should realize a pair in every theme').toEqual(['flooded', 'keep', 'ruins']);
  });

});

test.describe('all three themes read as a distinct macro change', { tag: '@capture' }, () => {
  test.use({ seeds: [FIXTURE_SEED] });
  for (const theme of ['keep', 'ruins', 'flooded'] as const) {
    test(`a ${theme} chamber's merged slabs and settled strip are captured for review`, async ({ game }) => {
      await game.enter();
      const floor = await game.floor();
      const room = pairRoom(floor, theme);
      expect(room, `seed fixture never realized a ${theme} pair`).toBeDefined();
      const centre = roomCentre(floor, room!.id);
      await game.teleport(centre.x, centre.z);
      await game.step(SETTLE);
      expect((await game.state()).mood.theme).toBe(theme);
      await freezeCombat(game);
      await game.capture(`paving-${theme}`);
    });
  }
});

test.describe('a narrow hall reads the same macro paving as a wide room', { tag: '@capture' }, () => {
  test.use({ seeds: [0x22] }); // 34 decimal: a 'hall'-shaped room realizes a pair here.

  test('a hall\'s merged slabs are captured for review', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    const pair = planPavingPatches(floor).pairs.find((p) => floor.rooms[p.room].shape === 'hall');
    expect(pair, 'seed 0x22 no longer plans a pair in a hall-shaped room').toBeDefined();
    const room = floor.rooms[pair!.room];
    const centre = roomCentre(floor, room.id);
    await game.teleport(centre.x, centre.z);
    await game.step(SETTLE);
    await freezeCombat(game);
    await game.capture('paving-narrow-hall');
  });
});

test.describe('a junction with several branches reads the same macro paving', { tag: '@capture' }, () => {
  test.use({ seeds: [0x2] });

  test('a junction\'s merged slabs and settled strip are captured for review', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    const junction = floor.rooms.find((r) =>
      floor.spine.includes(r.id) && floor.edges.filter(([a, b]) => a === r.id || b === r.id).length >= 3);
    expect(junction, 'seed 0x2 no longer holds the junction this fixture was set on').toBeDefined();
    const plan = planPavingPatches(floor);
    expect(plan.pairs.some((p) => p.room === junction!.id), 'the junction room no longer plans a pair').toBe(true);
    const centre = roomCentre(floor, junction!.id);
    await game.teleport(centre.x, centre.z);
    await game.step(SETTLE);
    await freezeCombat(game);
    await game.capture('paving-junction');
  });
});

test.describe('a bridge approach beside a merged slab reads cleanly', { tag: '@capture' }, () => {
  test.use({ seeds: [FIXTURE_SEED] });

  test('the wood-to-stone transition near a pair is captured for review, with no patch on the wood itself', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    const plan = planPavingPatches(floor);
    // A wood (bridge) tile close to one of the fixture's own pairs, so the capture shows both the
    // merged slab and the ordinary plank transition in one frame.
    const pair = plan.pairs.find((p) => p.room === 1)!;
    const bridge = floor.tiles.find((t) => t.wood && Math.hypot(t.x - pair.ax, t.z - pair.az) < 8);
    expect(bridge, 'seed fixture no longer has a bridge tile near room 1\'s pair').toBeDefined();
    for (const cell of [...plan.pairedCells, ...plan.settledCells]) {
      const [x, z] = cell.split(',').map(Number);
      expect(Math.hypot(x - bridge!.x, z - bridge!.z), `patch cell ${cell} sits on or beside the bridge tile itself`).toBeGreaterThan(1.5);
    }
    await game.teleport(bridge!.x * TILE, bridge!.z * TILE);
    await game.step(SETTLE);
    await freezeCombat(game);
    await game.capture('paving-bridge-transition');
  });
});

test.describe('macro paving on a phone', { tag: '@capture' }, () => {
  test.use({ seeds: [FIXTURE_SEED], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  /**
   * One isolated mobile context, not three: `isMobile`/`hasTouch`/`viewport` force a scenario off the
   * worker's pooled page (see `needsOwnPage` in helpers.ts), so each separate `test` here would pay a
   * full fresh page boot for the sake of walking to a different room. The fixture seed already
   * realizes all three themes' pairs on one floor, so a single boot walks the knight between them.
   */
  test('every theme\'s merged slabs read at phone size', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    for (const theme of ['keep', 'ruins', 'flooded'] as const) {
      const room = pairRoom(floor, theme);
      expect(room, `seed fixture never realized a ${theme} pair`).toBeDefined();
      const centre = roomCentre(floor, room!.id);
      await game.teleport(centre.x, centre.z);
      await game.step(SETTLE);
      await freezeCombat(game);
      await game.capture(`paving-${theme}-phone`);
    }
  });
});
