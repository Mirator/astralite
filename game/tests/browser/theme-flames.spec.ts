import { type Floor, type Game, expect, roomCentre, test } from './helpers.ts';

/**
 * Plan 005: witchfire, ordinary flame and bioluminescence get distinct silhouettes and motion
 * rhythms instead of sharing one octahedron and one animation. `dungeon-flame.test.ts` covers
 * the pose function's phase and bowl-floor bounds in isolation; what is worth asking here is whether the
 * running game actually attached the right shape to the right brazier and never lets the mood
 * transition swap one out from under a room it does not belong to - the same "attached, not
 * recomputed" question `floor-motifs.spec.ts` asks of the floor motifs plan 004 added.
 */

/** What every scene gets before its first frame: torches lit, water moving. */
const SETTLE = 640;

/** Four points along the same idle motion, so a capture set can show the rhythm, not one still. */
const PHASES = [0, 150, 300, 600];

/** A room of this theme that holds a brazier, so a capture actually shows what burns there. */
const litRoom = (floor: Floor, theme: 'keep' | 'ruins' | 'flooded') => {
  const braziers = floor.props.filter((prop) => prop.kind === 'brazier');
  return floor.rooms
    .filter((room) => room.theme === theme)
    .sort(
      (a, b) =>
        braziers.filter((p) => p.room === b.id).length - braziers.filter((p) => p.room === a.id).length ||
        a.id - b.id,
    )[0];
};

/** Holds every live enemy off cooldown, so a capture meant to show a flame does not instead catch a windup. */
const freezeCombat = async (game: Game) => {
  const state = await game.state();
  await game.configureCombat({ enemies: state.enemies.map((_, index) => ({ index, cooldown: 999, windup: 0 })) });
  await game.step(16);
};

/** Parks one live enemy beside the knight, mid-windup, clear of the brazier so neither covers the other. */
const standWithWindup = async (game: Game) => {
  const stand = await game.state();
  if (!stand.enemies.length) return;
  await game.configureCombat({
    health: stand.maxHealth,
    enemies: stand.enemies.map((_, index) => ({
      index,
      cooldown: 999,
      ...(index === 0 ? { x: stand.player.x + 1.6, z: stand.player.z + 1.6, hp: 8, windup: 0.5 } : {}),
    })),
  });
  await game.step(16);
};

test.describe('a brazier attaches its owning room\'s theme, not the floor\'s', () => {
  test.use({ seeds: [0x1] });

  test('theme and source count come from floor.rooms[prop.room], and every flame stands above its bowl', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    await game.step(SETTLE);
    const state = await game.state();

    const braziers = floor.props.filter((prop) => prop.kind === 'brazier');
    expect(
      state.graphics.flames.length,
      'a brazier was attached without a flame source, or a flame without a brazier',
    ).toBe(braziers.length);

    const expectedThemes = braziers.map((prop) => floor.rooms[prop.room].theme);
    expect(
      state.graphics.flames.map((f) => f.theme),
      'a brazier is burning a theme other than the one its own room declares - fire RGB or the camera room leaked in',
    ).toEqual(expectedThemes);

    // The flames are billboards now (plan 014), not the solid body and core the shape checks used to
    // measure, so what is left to ask of each one is where it was planted: never below the bowl rim.
    for (const f of state.graphics.flames) expect(f.y, `${f.theme} flame sits below the bowl rim`).toBeGreaterThanOrEqual(1.03);
  });

  test('the same instant redraws identically, and pausing freezes every source\'s pose', async ({ game }) => {
    await game.enter();
    await game.step(SETTLE);
    const settled = (await game.state()).graphics.flames;

    // Zero-time draws must not animate: a second draw at the same simulated instant is pixel-for-
    // pixel the same call, so its reported bounds have to match exactly.
    await game.step(0, true);
    const redrawn = (await game.state()).graphics.flames;
    expect(redrawn, 'a zero-time redraw at the same instant changed a flame\'s reported pose').toEqual(settled);

    await game.act('pause');
    await game.step(400, true);
    const paused = (await game.state()).graphics.flames;
    expect(paused, 'pausing did not freeze every source\'s pose').toEqual(settled);
    await game.act('pause');
  });

  test('crossing into another theme\'s room never swaps an old brazier\'s shape', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    await game.step(SETTLE);
    const before = (await game.state()).graphics.flames.map((f) => f.theme);

    const startTheme = floor.rooms[0].theme;
    const elsewhere = floor.rooms.find((room) => room.theme !== startTheme);
    if (elsewhere) {
      const centre = roomCentre(floor, elsewhere.id);
      await game.teleport(centre.x, centre.z);
      await game.step(SETTLE);
    }
    const after = (await game.state()).graphics.flames.map((f) => f.theme);
    expect(
      after,
      'a brazier changed which theme built it once the mood crossed into another room, rather than keeping the shape its own room owns',
    ).toEqual(before);
  });

  test('every halo burns the chamber\'s fire, and follows it across a threshold', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    await game.step(SETTLE);
    const inside = await game.state();
    // Plan 014 gave each halo its own material so it could fade beside the knight, and the recolour
    // went on reaching only the template they were cloned from: every halo stayed the build's orange.
    expect(inside.mood.halos, 'a halo is not the colour of the fire the room burns').toEqual([inside.mood.fire]);

    const elsewhere = floor.rooms.find((room) => room.theme !== floor.rooms[0].theme);
    expect(elsewhere, 'seed 0x1 holds a second theme').toBeDefined();
    const centre = roomCentre(floor, elsewhere!.id);
    await game.teleport(centre.x, centre.z);
    await game.step(SETTLE);
    const crossed = await game.state();
    expect(crossed.mood.fire, 'the fire did not change colour across the threshold, so this proves nothing').not.toBe(inside.mood.fire);
    expect(crossed.mood.halos, 'the halos kept the last chamber\'s fire').toEqual([crossed.mood.fire]);
  });

});

test.describe('the three profiles read as different silhouettes and rhythms', { tag: '@capture' }, () => {
  test.use({ seeds: [0x1] });
  for (const theme of ['keep', 'ruins', 'flooded'] as const) {
    test(`a ${theme} brazier is captured idle across its own rhythm, then mid-windup beside it`, async ({ game }) => {
      test.slow();
      await game.enter();
      const floor = await game.floor();
      const room = litRoom(floor, theme);
      expect(room, `seed 0x1 holds no ${theme} chamber`).toBeDefined();
      const centre = roomCentre(floor, room!.id);
      await game.teleport(centre.x, centre.z);
      await game.step(SETTLE);
      expect((await game.state()).mood.theme).toBe(theme);
      await freezeCombat(game);
      for (const ms of PHASES) {
        await game.step(ms);
        await game.capture(`flame-${theme}-idle-${ms}`);
      }
      // Mid-windup, with the enemy parked beside the knight rather than on the brazier, so the
      // capture shows the tell and the flame without either one standing in front of the other.
      await standWithWindup(game);
      await game.capture(`flame-${theme}-windup`);
    });
  }
});

test.describe('the three profiles on a phone', { tag: '@capture' }, () => {
  test.use({ seeds: [0x1], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  /**
   * One isolated mobile context for all three themes, not three: `isMobile`/`hasTouch`/`viewport`
   * all force this off the worker's pooled page (see `needsOwnPage` in helpers.ts), so a separate
   * `test` per theme would each pay a full fresh page boot for the sake of walking to a different
   * room. Seed 0x1 already realizes all three themes on one floor, so a single boot walks the
   * knight between them exactly as `floor-motifs.spec.ts` already does for the room motifs.
   */
  test('every theme brazier reads at phone size, idle and mid-windup', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    for (const theme of ['keep', 'ruins', 'flooded'] as const) {
      const room = litRoom(floor, theme);
      expect(room, `seed 0x1 holds no ${theme} chamber`).toBeDefined();
      const centre = roomCentre(floor, room!.id);
      await game.teleport(centre.x, centre.z);
      await game.step(SETTLE);
      await freezeCombat(game);
      await game.capture(`flame-${theme}-phone-idle`);
      await standWithWindup(game);
      await game.capture(`flame-${theme}-phone-windup`);
    }
  });
});
