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

  test('theme, source count and the core/body proportion all come from floor.rooms[prop.room]', async ({ game }) => {
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

    for (const f of state.graphics.flames) {
      for (const [name, part] of [['body', f.body], ['core', f.core]] as const) {
        expect(part.width, `${f.theme} ${name}: non-positive width`).toBeGreaterThan(0);
        expect(part.height, `${f.theme} ${name}: non-positive height`).toBeGreaterThan(0);
        expect(part.depth, `${f.theme} ${name}: non-positive depth`).toBeGreaterThan(0);
      }
      // Core is at most 65% of body height everywhere - never a white cap. Width/depth are 45-55%
      // of the body for `keep` and `flooded`, whose bodies have one peak and "width" cleanly means
      // how far that peak's own mass reaches. `ruins` is exempted from that specific number: its
      // body's width is mostly the gap BETWEEN its two peaks, not either peak's own size, and a core
      // held to the same 45-55% would have to pull the two peaks toward each other by that same
      // factor - which is exactly the "one spike, not two tongues" bug this shape was rebuilt to fix
      // (see the comment on `ruinsFlame`). It still has to be visibly smaller than the body on every
      // axis and never merely a re-tinted copy of it.
      const widthRatio = f.core.width / f.body.width, depthRatio = f.core.depth / f.body.depth;
      const heightRatio = f.core.height / f.body.height;
      expect(heightRatio, `${f.theme}: core is ${(heightRatio * 100).toFixed(0)}% of body height`).toBeLessThanOrEqual(0.66);
      if (f.theme === 'ruins') {
        expect(widthRatio, `${f.theme}: core is as wide as its own body, not a smaller hot centre`).toBeLessThan(0.95);
        expect(widthRatio, `${f.theme}: core has collapsed to almost nothing`).toBeGreaterThan(0.3);
        expect(depthRatio, `${f.theme}: core is as deep as its own body`).toBeLessThan(0.95);
      } else {
        expect(widthRatio, `${f.theme}: core is ${(widthRatio * 100).toFixed(0)}% of body width`).toBeGreaterThan(0.4);
        expect(widthRatio, `${f.theme}: core is ${(widthRatio * 100).toFixed(0)}% of body width`).toBeLessThan(0.6);
        expect(depthRatio, `${f.theme}: core is ${(depthRatio * 100).toFixed(0)}% of body depth`).toBeGreaterThan(0.4);
        expect(depthRatio, `${f.theme}: core is ${(depthRatio * 100).toFixed(0)}% of body depth`).toBeLessThan(0.6);
      }
      // Never below the bowl rim, even at whatever extreme this instant's breathing/bob reached.
      expect(f.body.y, `${f.theme} body base sits below the bowl rim`).toBeGreaterThanOrEqual(1.03);
    }
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

  test('a pinned-seed rebuild after all three shapes have drawn settles at stable counts', async ({ game }) => {
    await game.enter();
    await game.step(SETTLE);
    const counts: { flames: number; geometries: number; textures: number }[] = [];
    for (let i = 0; i < 3; i++) {
      await game.buildFloor(1);
      await game.step(0, true);
      const state = await game.state();
      counts.push({ flames: state.graphics.flames.length, geometries: state.render.geometries, textures: state.render.textures });
    }
    const last = counts[counts.length - 1];
    for (const count of counts.slice(1)) {
      expect(count, 'flame source count or the renderer\'s own resource counts drifted across identical rebuilds').toEqual(last);
    }
  });
});

test.describe('the three profiles read as different silhouettes and rhythms', () => {
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

test.describe('the three profiles on a phone', () => {
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
