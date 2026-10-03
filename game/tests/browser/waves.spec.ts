import { simulateLevel } from '../../scripts/balance/sim.ts';
import { WAVE_CLEAR } from '../../app/dungeon-waves.ts';
import { DEFAULT_SEEDS, expect, stanceNear, swing, test, TILE, until, type Snapshot } from './helpers.ts';

// Plan 022 Stage B. What a wave is, as the running game plays it: dealt by `dealWaves` and read back off the scene, dormant until its chamber calls it, called only when every body before it is down, rung on the floor
// first and raised on the rings, the chamber's doors barred until the last wave falls. The rules themselves (the caps, the clearance, the clock) are held in node by `tests/dungeon-waves.test.ts`; this holds that the
// game is wired to them. The harness boots every page with `?waves=off` (helpers.ts `DEFAULT_WAVES`), so each scenario that needs waves opts in with `test.use({ waves: null })` and has a page of its own.

test.describe('a chamber that fights in waves', () => {
  test.use({ waves: null, seeds: [0x7] });
  test('calls each wave only once the one before has fallen, rings it first, raises it on the rings, and keeps its doors barred until the last falls', async ({ game, page }) => {
    test.slow();
    await game.enter();
    const floor = await game.floor();
    const opening = await game.state();
    expect(opening.corpses, 'precondition: nothing has fallen, so snapshot indices are spawn indices').toHaveLength(0);
    const bodiesOf = (state: Snapshot, room: number, wave: number) => state.enemies.map((e, index) => ({ e, index })).filter(({ e }) => e.room === room && e.wave === wave && !e.buried);
    // A chamber of three waves with at least two bodies in each (a chamber too crowded for its second wave deals a lone warden for its third).
    const room = floor.rooms.find((r) => [1, 2, 3].every((wave) => bodiesOf(opening, r.id, wave).length >= 2));
    expect(room, 'seed 0x7 floor 1 no longer holds a chamber of three waves of two bodies or more: pick another seed').toBeDefined();
    const [first, second, third] = [1, 2, 3].map((wave) => bodiesOf(opening, room!.id, wave));
    const dormant = (state: Snapshot, wave: number) => bodiesOf(state, room!.id, wave).every(({ e }) => !e.awake && !e.visible);

    // Walking in springs the first wave and nothing after it.
    await game.teleport(room!.entry.x * TILE, room!.entry.z * TILE);
    await game.step(200);
    const entered = await game.state();
    expect(entered.chamber.id).toBe(room!.id);
    expect(entered.chamber.sealed, 'the chamber did not seal on arrival').toBe(true);
    expect(bodiesOf(entered, room!.id, 1).every(({ e }) => e.awake), 'the first wave did not stand').toBe(true);
    expect(dormant(entered, 2) && dormant(entered, 3), 'a later wave woke when the knight walked in').toBe(true);
    expect(entered.chamber.wave).toEqual({ at: 1, of: 3, marked: false });

    // The knight stands where the second wave was dealt to stand: its ring has to be moved off him.
    const dealt = second.map(({ e }) => ({ x: e.x, z: e.z }));
    const stance = stanceNear(floor, dealt[0], WAVE_CLEAR - 0.2, Math.max(first.length, second.length, third.length));
    expect(Math.min(...dealt.map((spot) => Math.hypot(spot.x - stance.x, spot.z - stance.z))), 'precondition: the knight stands inside the clearance of a spot the second wave was dealt').toBeLessThan(WAVE_CLEAR);
    await game.teleport(stance.x, stance.z);
    await game.step(50);

    // Each wave in turn: stage its bodies in the arc one blow from death (mid-windup, so crowd separation leaves them where they stand), strike for real, and read what the chamber does.
    let barred = 0;
    for (const [n, wave] of [[1, first], [2, second], [3, third]] as const) {
      const indices = wave.map(({ index }) => index);
      await game.configureCombat({ enemies: indices.map((index, i) => ({ index, x: stance.slots[i].x, z: stance.slots[i].z, hp: 1, windup: 0.3, cooldown: 30, aim: { x: -stance.facing.x, z: -stance.facing.z } })) });
      await game.step(16);
      const staged = await game.state();
      expect(bodiesOf(staged, room!.id, n).every(({ e }) => e.awake && e.hp === 1), `wave ${n} was not standing and one blow from death`).toBe(true);
      await swing(page, stance.key);
      await game.step(220);
      const felled = await game.state();
      expect(felled.enemies.filter((e) => e.room === room!.id && !e.buried && e.wave <= n && e.awake), `wave ${n} survived the blow`).toHaveLength(0);
      if (n < 3) {
        // The chamber is not clear: it holds its doors while a wave is still to come, and nothing of it has stood yet.
        expect(felled.chamber.sealed, `the chamber opened when wave ${n} fell, with wave ${n + 1} still to come`).toBe(true);
        expect(felled.chamber.doors.length, 'precondition: the chamber has a way on').toBeGreaterThan(0);
        expect(felled.chamber.doors.every((door) => !door.open), `a door opened when wave ${n} fell`).toBe(true);
        expect(felled.waveMarks, 'the rings were down at the instant of the last blow: the pause was skipped').toHaveLength(0);
        expect(dormant(felled, n + 1), `wave ${n + 1} stood at the instant wave ${n} fell`).toBe(true);
        barred++;
        // After the pause its rings go down - and only then.
        const marked = await until(game, `the rings of wave ${n + 1}`, (s) => s.waveMarks.length > 0);
        const next = bodiesOf(marked, room!.id, n + 1);
        expect(marked.waveMarks.length, 'precondition: every body of the next wave has its ring drawn').toBe(next.length);
        expect(marked.waveMarks.every((mark) => mark.visible && mark.wave === n + 1 && mark.room === room!.id), 'a ring is not showing, or is for the wrong wave').toBe(true);
        expect(marked.chamber.wave, 'the snapshot does not say the rings are showing').toMatchObject({ at: n, of: 3, marked: true });
        expect(dormant(marked, n + 1), `wave ${n + 1} stood while its rings were still showing`).toBe(true);
        const knight = marked.player;
        for (const mark of marked.waveMarks) expect(Math.hypot(mark.x - knight.x, mark.z - knight.z), 'a ring lands within the clearance of the knight').toBeGreaterThanOrEqual(WAVE_CLEAR);
        // The knight stands on a spot the second wave was dealt to: its ring is not where the body was dealt.
        if (n === 1) {
          const moved = marked.waveMarks.filter((mark) => dealt.some((spot) => Math.hypot(spot.x - knight.x, spot.z - knight.z) < WAVE_CLEAR && Math.hypot(spot.x - mark.x, spot.z - mark.z) > 0.01));
          expect(moved.length, 'precondition: no ring was moved off the knight, so the clearance was not exercised').toBeGreaterThan(0);
        }
        // And the bodies stand on the rings, for good.
        const rung = marked.waveMarks.map((mark) => ({ index: mark.index, x: mark.x, z: mark.z }));
        const up = await until(game, `wave ${n + 1} standing`, (s) => bodiesOf(s, room!.id, n + 1).every(({ e }) => e.awake), 2000);
        expect(up.waveMarks, 'the rings stayed down after the wave stood').toHaveLength(0);
        // Matched by place: a standing body is a snapshot entry, and the dead have left the list, so spawn indices no longer line up with it.
        const risen = bodiesOf(up, room!.id, n + 1).map(({ e }) => e), unmatched = [...risen];
        expect(risen.length, 'precondition: every ringed body stood').toBe(rung.length);
        for (const ring of rung) {
          const at = unmatched.findIndex((e) => Math.hypot(e.x - ring.x, e.z - ring.z) < 0.6);
          expect(at, `no body rose on the ring at (${ring.x.toFixed(2)}, ${ring.z.toFixed(2)})`).toBeGreaterThanOrEqual(0);
          expect(unmatched[at].visible, 'a risen body is not drawn').toBe(true);
          unmatched.splice(at, 1);
        }
        expect(up.chamber.sealed && up.chamber.doors.every((door) => !door.open), 'the doors opened while a wave stood').toBe(true);
      } else {
        expect(felled.chamber.sealed, 'the last wave fell and the chamber stayed sealed').toBe(false);
        // The wave's nine kills (25 each) crossed the 200 XP of rank one, so a boon is on offer and the world is frozen under it: the door pass runs again once a card is taken.
        expect(felled.boonOffer, 'precondition: nine kills crossed a rank').toBe(true);
        await game.takeBoon();
        await game.step(50);
        expect((await game.state()).chamber.doors.every((door) => door.open), 'a door stayed barred after the last wave').toBe(true);
        expect(felled.chamber.wave).toMatchObject({ at: 3, of: 3, marked: false });
      }
    }
    expect(barred, 'precondition: both pauses between waves were crossed').toBe(2);
  });
});

test.describe('the later waves', () => {
  test('are off on a harness page, so a pack is what the generator laid', async ({ game }) => {
    await game.enter();
    const floor = await game.floor(), state = await game.state();
    expect(state.enemies.length, 'the harness page dealt a wave: `?waves=off` is not reaching the game').toBe(floor.spawns.length);
    expect(state.enemies.every((e) => e.wave === 1)).toBe(true);
  });
});

test.describe('the sim and the game', () => {
  test.use({ waves: null, seeds: DEFAULT_SEEDS });
  test('deal the same waves to the same floors', async ({ game }) => {
    test.slow();
    await game.enter();
    const seen: Record<number, string[]> = {};
    for (const level of [1, 2, 3]) {
      if (level > 1) { await game.buildFloor(level); await game.step(0); }
      const state = await game.state();
      expect(state.floor.level, 'the page is not on the floor this scenario asked for').toBe(level);
      // Read off the running scene: every body of a later wave the game stood on this floor, dormant and buried alike.
      const scene = state.enemies.filter((e) => e.wave > 1).map((e) => `${e.room}:${e.wave}:${e.kind}:${e.buried}`).sort();
      expect(scene.length, `precondition: floor ${level} of the page holds no later wave`).toBeGreaterThan(5);
      // Read off the bodies the sim ran on the floor of the same seed and level.
      const run = simulateLevel(state.floor.seed, level);
      seen[level] = run.waveBodies.map((b) => `${b.room}:${b.wave}:${b.kind}:${b.buried}`).sort();
      expect(seen[level], `floor ${level} (seed ${state.floor.seed}): the sim and the game were not dealt the same waves`).toEqual(scene);
    }
  });
});
