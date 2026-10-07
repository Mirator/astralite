import { planFloorMotifs } from '../../app/dungeon-decor-layout.ts';
import { type Floor, expect, Game, roomCentre, test } from './helpers.ts';

/**
 * The three theme motifs replace a compass carved into almost every room the same way. This checks
 * the real scene rather than the pure planner a second time - `dungeon-decor-layout.test.ts` and
 * `dungeon-floor-motifs.test.ts` already cover `planRoomMotif`/`buildFloorMotifs` in isolation, so
 * what is worth asking here is whether `dungeon-art.ts` actually wired the two together: the live
 * `graphics.motifs` the running game reports has to be exactly what an independent call to
 * `planFloorMotifs` on the same floor says it should be, not a second recomputation standing in for
 * a look at the attached scene.
 */

/** What every scene gets before its first frame: torches lit, water moving. */
const SETTLE = 640;

const realizedKey = (m: { room: number; theme: string }) => `${m.room}:${m.theme}`;

/**
 * Holds every live enemy off cooldown, so a capture meant to show a motif does not instead catch
 * whichever guard's windup happened to land in the settle window - the same freeze
 * `art-direction.spec.ts` uses before it draws a chamber for review.
 */
const freezeCombat = async (game: Game) => {
  const state = await game.state();
  await game.configureCombat({
    enemies: state.enemies.map((_, index) => ({ index, cooldown: 999, windup: 0 })),
  });
  await game.step(16);
};

/**
 * A room that actually realized a motif of this theme - read off the live scene's own
 * `graphics.motifs` rather than picked from `floor.rooms` by theme alone, which would just as
 * happily hand back a sanctuary that plans no motif at all (a keep sanctuary never does) and
 * capture nothing for review. A plain room is preferred when one realized, so the reference frame
 * shows the ordinary construction rather than a sanctuary's narrower, clear-centred one.
 */
const motifRoom = (floor: Floor, realized: { room: number; theme: string }[], theme: 'keep' | 'ruins' | 'flooded') => {
  const candidates = realized.filter((m) => m.theme === theme).map((m) => floor.rooms[m.room]);
  return candidates.find((room) => room.encounter !== 'sanctuary') ?? candidates[0];
};

test.describe('the floor realizes exactly the motifs the planner plans', () => {
  test.use({ seeds: [0x1] });

  test('three different theme motifs are attached, and none where the palette forbids one', async ({ game }) => {
    test.slow();
    await game.enter();
    const floor = await game.floor();
    await game.step(SETTLE);
    const state = await game.state();

    const expected = planFloorMotifs(floor).map(realizedKey).sort();
    const realized = state.graphics.motifs.map(realizedKey).sort();
    expect(
      realized,
      'the live scene attached a different set of motifs than the pure planner plans for the same floor',
    ).toEqual(expected);

    const themes = new Set(state.graphics.motifs.map((m) => m.theme));
    expect(
      [...themes].sort(),
      `seed 0x1 realized only ${[...themes].join(', ') || 'nothing'}; expected all three themes`,
    ).toEqual(['flooded', 'keep', 'ruins']);

    for (const room of floor.rooms) {
      if (room.encounter !== 'gauntlet' && room.role !== 'goal') continue;
      expect(
        state.graphics.motifs.some((m) => m.room === room.id),
        `room ${room.id} (${room.encounter}/${room.role}) should never carry a floor motif`,
      ).toBe(false);
    }

    // A sanctuary keeps its shrine centre clear rather than showing a solid keep bed there; the
    // pure planner already refuses a keep motif for one, so the live scene inherits the same rule
    // by construction - this is the "attached, not recomputed" half of that claim.
    for (const room of floor.rooms) {
      if (room.encounter !== 'sanctuary') continue;
      const attached = state.graphics.motifs.find((m) => m.room === room.id);
      if (attached) expect(attached.theme, `sanctuary room ${room.id} realized a solid keep bed`).not.toBe('keep');
    }
  });

  // The one rebuild-leak test in the suite (polish.spec.ts and footsteps.spec.ts each used to keep a weaker
  // copy). It used to rebuild floor three four times over; a leak that only shows when the floor changes - a
  // per-floor texture or material kept from one seed to the next - passed that, since the same floor rebuilt
  // replaces like with like. So the run descends one keep, restarts, descends another, and comes back to the
  // first: each floor must cost on its return what it cost the first time, whatever was built in between,
  // and once both keeps have been seen no build may link a shader program the game had not linked before.
  test('a descent, a restart and another keep leave geometry, texture and program counts where they were', async ({ game, page }) => {
    await game.enter();
    await game.step(SETTLE);
    type Cost = { geometries: number; textures: number; programs: number };
    const visit = async (level: number, seed: number): Promise<Cost> => {
      await page.evaluate(([value, from]) => {
        const hook = (window as import('./helpers.ts').GameWindow).dungeonTest;
        if (!hook) throw new Error('dungeonTest is gone');
        hook.buildFloor(value, from);
      }, [level, seed] as const);
      await game.settle();
      await game.step(0, true);
      const { geometries, textures, programs } = (await game.state()).render;
      return { geometries, textures, programs };
    };
    const restart = async (seed: number) => {
      await page.evaluate((from) => (window as import('./helpers.ts').GameWindow).dungeonTest!.reset(from), seed);
      await game.settle();
    };
    const A = 0x1, B = 0x5eed, levels = [1, 2, 3];
    const first: Cost[] = [];
    for (const level of levels) first.push(await visit(level, A));
    await restart(B);
    const other: Cost[] = [];
    for (const level of levels) other.push(await visit(level, B));
    const seenBoth = other[other.length - 1].programs;
    await restart(A);
    const again: Cost[] = [];
    for (const level of levels) again.push(await visit(level, A));
    // Precondition: the second keep's floors are not the first's, or "whatever was built in between" built the same thing.
    expect(other.map(c => c.geometries), 'seed B built the same floors as seed A, so nothing changed between the visits').not.toEqual(first.map(c => c.geometries));
    levels.forEach((level, i) => {
      expect({ geometries: again[i].geometries, textures: again[i].textures }, `floor ${level} of seed A cost more on its return than on its first visit - a leak across floors or the restart`)
        .toEqual({ geometries: first[i].geometries, textures: first[i].textures });
      expect(again[i].programs, `floor ${level} of seed A linked a shader program after both keeps had been seen`).toBe(seenBoth);
    });
  });
});

test.describe('the three motifs read as different constructions', { tag: '@capture' }, () => {
  test.use({ seeds: [0x1] });
  for (const theme of ['keep', 'ruins', 'flooded'] as const) {
    test(`a ${theme} chamber's motif is captured for review`, async ({ game }) => {
      await game.enter();
      const floor = await game.floor();
      const realized = (await game.state()).graphics.motifs;
      const room = motifRoom(floor, realized, theme);
      expect(room, `seed 0x1 never realized a ${theme} motif`).toBeDefined();
      const centre = roomCentre(floor, room!.id);
      await game.teleport(centre.x, centre.z);
      await game.step(SETTLE);
      expect((await game.state()).mood.theme).toBe(theme);
      await freezeCombat(game);
      await game.capture(`motif-${theme}`);
    });
  }
});

test.describe('the three motifs on a phone', { tag: '@capture' }, () => {
  test.use({ seeds: [0x1], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  /**
   * One isolated mobile context, not three: `isMobile`/`hasTouch`/`viewport` all force a scenario off
   * the worker's pooled page (see `needsOwnPage` in helpers.ts), so each separate `test` here used to
   * pay a full fresh page boot - module load, a WebGL context, a first floor - for the sake of walking
   * to a different room. Seed 0x1 already realizes all three themes on the one floor (proven above, in
   * "three different theme motifs are attached"), so a single boot can walk the knight between them
   * exactly as the desktop capture describe block below already reviews all three from one pooled page.
   */
  test('every theme chamber motif reads at phone size', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    const realized = (await game.state()).graphics.motifs;
    for (const theme of ['keep', 'ruins', 'flooded'] as const) {
      const room = motifRoom(floor, realized, theme);
      expect(room, `seed 0x1 never realized a ${theme} motif`).toBeDefined();
      const centre = roomCentre(floor, room!.id);
      await game.teleport(centre.x, centre.z);
      await game.step(SETTLE);
      await freezeCombat(game);
      await game.capture(`motif-${theme}-phone`);
    }
  });
});
