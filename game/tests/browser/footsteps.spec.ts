import { cellKey } from '../../app/dungeon-floor.ts';
import { contactCount } from '../../app/dungeon-footstep-rules.ts';
import { FOOTSTEP_LOOK } from '../../app/dungeon-footsteps.ts';
import { ARROW_KEYS, canStand, expect, type Floor, type Game, type GameWindow, roomCentre, SCREEN_DIRECTIONS, type ScreenDirection, type Snapshot, test, TILE } from './helpers.ts';


/** Seed 0x5d, level 1: three empty chambers, one per theme (0 keep, the gate; 7 ruins and 12 flooded, both shrines). */
const SEED = 0x5d;
const ROOMS = { keep: 0, ruins: 7, flooded: 12 } as const;
const DIRECTIONS: ScreenDirection[] = ['right', 'left', 'down', 'up'];

type Footsteps = Snapshot['effects']['footsteps'];

const steps = (state: Snapshot): Footsteps => state.effects.footsteps;
const particles = (game: Game) => game.page.evaluate(() => {
  const hook = (window as GameWindow).dungeonTest?.footstepParticles;
  if (!hook) throw new Error('dungeonTest.footstepParticles is gone');
  return hook();
});

/** A straight walk of `length` from `from` along `direction` whose whole body width stays on cells `ok` accepts. */
const clearLane = (floor: Floor, from: { x: number; z: number }, direction: { x: number; z: number }, length: number, ok: (key: string) => boolean) => {
  for (let s = 0; s <= length; s += 0.2) {
    for (const lateral of [-0.5, 0, 0.5]) {
      const x = from.x + direction.x * s - direction.z * lateral, z = from.z + direction.z * s + direction.x * lateral;
      if (!canStand(floor.cells, x, z) || !ok(cellKey(Math.round(x / TILE), Math.round(z / TILE)))) return false;
    }
  }
  return true;
};
/** Every screen direction that walks 4 units straight out of a room's centre on its own stone. */
const roomLanes = (floor: Floor, room: number) => {
  const centre = roomCentre(floor, room);
  const lanes = DIRECTIONS.filter(d => clearLane(floor, centre, SCREEN_DIRECTIONS[d], 4, k => floor.roomByCell.get(k) === room));
  expect(lanes.length, `seed 0x${SEED.toString(16)} room ${room} has no clear stone lane any more; pick a new fixture`).toBeGreaterThan(0);
  return { centre, lanes };
};

test.describe('footfalls on real stone', () => {
  test.use({ seeds: [SEED] });

  test('each contact plants dust at the leading boot, on the sampled stone, in all four screen directions', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    const { centre, lanes } = roomLanes(floor, ROOMS.keep);
    expect(lanes, 'the keep sanctuary no longer has all four lanes').toEqual(DIRECTIONS);
    for (const direction of DIRECTIONS) {
      await game.teleport(centre.x, centre.z);
      await game.step(16);
      const key = ARROW_KEYS[direction], contactsBefore = steps(await game.state()).contacts;
      await game.page.keyboard.down(key);
      let seen = 0, lastSide: number | null = null;
      for (let i = 0; i < 26; i++) {
        const before = steps(await game.state()).emitted;
        await game.step(16);
        const state = await game.state(), feet = steps(state);
        if (feet.emitted === before) continue;
        const last = feet.last!;
        seen++;
        expect(last.kind, `${direction}: dust in the keep sanctuary classified as ${last.kind}`).toBe('keep');
        // The body's own frame, off the rendered rotation: forward is local -Z, the leg's side local X.
        const yaw = state.player.rotation, rel = { x: last.x - state.player.x, z: last.z - state.player.z };
        const forward = rel.x * -Math.sin(yaw) + rel.z * -Math.cos(yaw), lateral = rel.x * Math.cos(yaw) + rel.z * -Math.sin(yaw);
        expect(forward, `${direction}: contact ${last.count} is not under the leading boot (forward ${forward.toFixed(3)})`).toBeGreaterThan(0.05);
        expect(Math.sign(lateral), `${direction}: contact ${last.count} used the wrong leg (lateral ${lateral.toFixed(3)}, side ${last.side})`).toBe(last.side === 0 ? -1 : 1);
        expect(Math.abs(lateral)).toBeLessThan(0.35);
        if (lastSide !== null) expect(last.side, `${direction}: two contacts in a row on one foot`).not.toBe(lastSide);
        lastSide = last.side;
        // The support is the realized paving top, never an invented plane or the sea under the walkway.
        expect(last.y).toBeGreaterThan(-0.08); expect(last.y).toBeLessThan(0.14);
        // Born this update, around this sole: the rim of the boot, never the far side of the body.
        const born = (await particles(game)).filter(p => p.age <= 0.0161 && Math.hypot(p.ox - last.x, p.oz - last.z) < 0.2);
        expect(born.length, `${direction}: contact ${last.count} spawned nothing at the sole`).toBeGreaterThan(0);
        for (const p of born) {
          expect(Math.abs(p.oy - (last.y + 0.015))).toBeLessThan(1e-6);
          expect(p.y - p.oy).toBeLessThanOrEqual(FOOTSTEP_LOOK.keep.height[1] + 1e-6);
        }
      }
      await game.page.keyboard.up(key);
      // A contact whose sole lands in the seam between two slabs is skipped by design, so one emission
      // is the floor here; the phase crossings themselves must still be two or more.
      expect(seen, `${direction}: a 416 ms walk on stone planted no dust`).toBeGreaterThanOrEqual(1);
      // Every phase crossing since the reset was seen as a contact, which is exactly the audio cadence.
      const state = await game.state();
      expect(steps(state).contacts - contactsBefore, `${direction}: fewer than two footfalls in 416 ms of running`).toBeGreaterThanOrEqual(2);
      expect(steps(state).contacts).toBe(contactCount(state.player.locomotion.phase));
      await game.step(400);
      const settled = steps(await game.state());
      expect(settled.active, `${direction}: dust outlived the stride that raised it`).toBe(0);
      expect(settled.drawn).toBe(false);
    }
  });

});
