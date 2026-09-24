import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { cellKey } from '../../app/dungeon-floor.ts';
import { contactCount } from '../../app/dungeon-footstep-rules.ts';
import { FOOTSTEP_LOOK, REDUCED_FOOTSTEP } from '../../app/dungeon-footsteps.ts';
import { ARROW_KEYS, canStand, CAPTURING, expect, type Floor, type FootstepParticle, type Game, type GameWindow, roomCentre, SCREEN_DIRECTIONS, type ScreenDirection, type Snapshot, strikeStance, test, TILE } from './helpers.ts';

/**
 * Plan 008: restrained surface feedback at real foot contacts. Everything here is driven by real
 * keyboard input under stepped time; the pool's own diagnostics (`effects.footsteps`, and the
 * development-only `footstepParticles`) are read back for the assertions, and the pixel checks draw the
 * identical instant with the batch off and on inside one evaluated task, so "a fleck is on screen at
 * the boot" is a measured difference rather than an impression.
 */

/** Seed 0x5d, level 1: three empty sanctuaries, one per theme (0 keep, 5 ruins, 7 flooded), and bridges. */
const SEED = 0x5d;
const ROOMS = { keep: 0, ruins: 5, flooded: 7 } as const;
/** Torches lit, water moving, mood settled - before a frame that is going to be looked at. */
const SETTLE = 640;
const DIRECTIONS: ScreenDirection[] = ['right', 'left', 'down', 'up'];

type Kind = keyof typeof ROOMS;
type Footsteps = Snapshot['effects']['footsteps'];
type Camera = { x: number; z: number; focusX: number; focusZ: number };
/** Snapshot fields the shared `Snapshot` type does not spell out. */
const extra = (state: Snapshot) => state as unknown as { camera: Camera; settings: { hitStop: number; reduceMotion: boolean } };

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
const woodCells = (floor: Floor) => new Set(floor.tiles.filter(t => t.wood).map(t => cellKey(t.x, t.z)));
/** Every screen direction that walks 4 units straight out of a room's centre on its own stone. */
const roomLanes = (floor: Floor, room: number) => {
  const wood = woodCells(floor), centre = roomCentre(floor, room);
  const lanes = DIRECTIONS.filter(d => clearLane(floor, centre, SCREEN_DIRECTIONS[d], 4, k => floor.roomByCell.get(k) === room && !wood.has(k)));
  expect(lanes.length, `seed 0x${SEED.toString(16)} room ${room} has no clear stone lane any more; pick a new fixture`).toBeGreaterThan(0);
  return { centre, lanes };
};

/** Holds a direction and steps 16 ms at a time until a new contact is emitted. The key stays down. */
const walkToContact = async (game: Game, key: string, limit = 60) => {
  const before = steps(await game.state()).emitted;
  await game.page.keyboard.down(key);
  for (let i = 0; i < limit; i++) {
    await game.step(16);
    const state = await game.state();
    if (steps(state).emitted > before) return state;
  }
  throw new Error(`no footstep contact within ${limit * 16} ms of holding ${key}`);
};

/** Where a world point lands on the canvas, from the snapshot's own camera and frustum. */
const project = (state: Snapshot, width: number, height: number, p: { x: number; y: number; z: number }) => {
  const camera = extra(state).camera, { span, aspect } = state.aim;
  const view = new THREE.OrthographicCamera(-span * aspect, span * aspect, span, -span, 0.1, 200);
  view.position.set(camera.x, 12.5, camera.z); view.lookAt(camera.focusX, 0, camera.focusZ); view.updateMatrixWorld();
  const ndc = new THREE.Vector3(p.x, p.y, p.z).project(view);
  return { x: (ndc.x + 1) / 2 * width, y: (1 - ndc.y) / 2 * height };
};

/**
 * The same instant drawn twice, batch off then on, differenced in the page: which pixels the live
 * particles changed, where their centre is, and the draw-call cost of the batch. Nothing advances.
 */
const footstepFrames = (game: Game) => game.page.evaluate(() => {
  const win = window as GameWindow, hook = win.dungeonTest, advance = win.advanceTime, text = win.render_game_to_text;
  if (!hook?.setFootstepsEnabled || !hook.footstepParticles || !advance || !text) throw new Error('footstep hooks are gone');
  const gl = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
  const copy = document.createElement('canvas'); copy.width = gl.width; copy.height = gl.height;
  const ctx = copy.getContext('2d', { willReadFrequently: true })!;
  const frame = () => { ctx.clearRect(0, 0, copy.width, copy.height); ctx.drawImage(gl, 0, 0); return ctx.getImageData(0, 0, copy.width, copy.height).data; };
  hook.setFootstepsEnabled(false); advance(0, true); const off = frame(); const offCalls = JSON.parse(text()).render.calls as number;
  hook.setFootstepsEnabled(true); advance(0, true); const on = frame(); const onCalls = JSON.parse(text()).render.calls as number;
  let changed = 0, sx = 0, sy = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, peak = 0;
  for (let i = 0; i < on.length; i += 4) {
    const delta = Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2]);
    peak = Math.max(peak, delta);
    if (delta <= 3) continue;
    const x = (i / 4) % copy.width, y = Math.floor(i / 4 / copy.width);
    changed++; sx += x; sy += y; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { width: copy.width, height: copy.height, changed, peak, centroid: changed ? { x: sx / changed, y: sy / changed } : null, box: { minX, minY, maxX, maxY }, offCalls, onCalls, particles: hook.footstepParticles() };
});

/** The pixel proof: live particles changed pixels, one extra draw, all of it where the particles project to. */
const provePixels = async (game: Game, label: string) => {
  const frames = await footstepFrames(game);
  const state = await game.state();
  expect(frames.particles.length, `${label}: nothing alive to draw`).toBeGreaterThan(0);
  expect(frames.onCalls - frames.offCalls, `${label}: the batch did not cost exactly one draw`).toBe(1);
  const points = frames.particles.map(p => project(state, frames.width, frames.height, p));
  const centre = { x: points.reduce((a, p) => a + p.x, 0) / points.length, y: points.reduce((a, p) => a + p.y, 0) / points.length };
  console.log(`FOOTSTEP ${label} particles=${frames.particles.length} changed=${frames.changed}px peakDelta=${frames.peak} projected=(${centre.x.toFixed(1)},${centre.y.toFixed(1)}) centroid=${frames.centroid ? `(${frames.centroid.x.toFixed(1)},${frames.centroid.y.toFixed(1)})` : 'none'} box=${JSON.stringify(frames.box)} canvas=${frames.width}x${frames.height}`);
  expect(frames.changed, `${label}: live particles changed no pixels at all - not on screen`).toBeGreaterThan(0);
  // Some particles sit behind the boot or the other leg and are rightly depth-hidden, so the test is
  // that every changed pixel lies within a few pixels of where SOME live particle projects, not that
  // the changed centroid matches all of them.
  const slack = 8 * frames.height / 700;
  const inside = (x: number, y: number) => points.some(p => Math.abs(p.x - x) < slack && Math.abs(p.y - y) < slack);
  expect(inside(frames.box.minX, frames.box.minY) || inside(frames.box.minX, frames.box.maxY) || inside(frames.box.maxX, frames.box.minY) || inside(frames.box.maxX, frames.box.maxY), `${label}: the changed pixels are not where the particles project to`).toBe(true);
  const px = points.map(p => p.x), py = points.map(p => p.y);
  expect(frames.box.minX, `${label}: changed pixels left of every particle`).toBeGreaterThan(Math.min(...px) - slack);
  expect(frames.box.maxX, `${label}: changed pixels right of every particle`).toBeLessThan(Math.max(...px) + slack);
  expect(frames.box.minY, `${label}: changed pixels above every particle`).toBeGreaterThan(Math.min(...py) - slack);
  expect(frames.box.maxY, `${label}: changed pixels below every particle`).toBeLessThan(Math.max(...py) + slack);
  return { frames, centre };
};

/**
 * A native-resolution frame, plus a review sheet of the contact at 4x nearest-neighbour: the same
 * instant with the batch off, with it on, and their difference amplified 6x, left to right. All three
 * panels are copied out of the framebuffer in the same task as their draws. Only when capturing.
 */
const captureContact = async (game: Game, name: string, at: { x: number; y: number }) => {
  if (!CAPTURING) return;
  await game.capture(name);
  const url = await game.page.evaluate((spot: { x: number; y: number }) => {
    const win = window as GameWindow, advance = win.advanceTime!, set = win.dungeonTest!.setFootstepsEnabled!;
    const gl = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
    const w = 80, h = 60, zoom = 4, x0 = Math.round(spot.x - w / 2), y0 = Math.round(spot.y - h / 2);
    const grab = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(gl, x0, y0, w, h, 0, 0, w, h); return c; };
    set(false); advance(0, true); const off = grab();
    set(true); advance(0, true); const on = grab();
    const a = off.getContext('2d')!.getImageData(0, 0, w, h), b = on.getContext('2d')!.getImageData(0, 0, w, h);
    const diff = document.createElement('canvas'); diff.width = w; diff.height = h;
    const d = diff.getContext('2d')!, img = d.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) { for (let k = 0; k < 3; k++) img.data[i + k] = Math.min(255, Math.abs(b.data[i + k] - a.data[i + k]) * 6); img.data[i + 3] = 255; }
    d.putImageData(img, 0, 0);
    const out = document.createElement('canvas'); out.width = w * zoom * 3 + 8; out.height = h * zoom;
    const ctx = out.getContext('2d')!; ctx.imageSmoothingEnabled = false; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
    [off, on, diff].forEach((panel, i) => ctx.drawImage(panel, 0, 0, w, h, i * (w * zoom + 4), 0, w * zoom, h * zoom));
    return out.toDataURL('image/png');
  }, at);
  const file = game.info.outputPath(`${name}-closeup.png`);
  await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
  await game.info.attach(`${name}-closeup`, { path: file, contentType: 'image/png' });
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

  test('nothing at rest, into a wall, through a dash, on redraws or while paused; teleport clears', async ({ game, page }) => {
    await game.enter();
    await game.step(600);
    let feet = steps(await game.state());
    expect([feet.contacts, feet.emitted, feet.active, feet.drawn]).toEqual([0, 0, 0, false]);

    // Walking, then a zero-time redraw and a pause: particles and pixels hold exactly still.
    const floor = await game.floor();
    const { centre, lanes } = roomLanes(floor, ROOMS.keep);
    await game.teleport(centre.x, centre.z);
    await walkToContact(game, ARROW_KEYS[lanes[0]]);
    const held = await particles(game);
    expect(held.length).toBeGreaterThan(0);
    // Draw, redraw three more times at zero time, draw again - one task, differenced in the page with the
    // same eight-level threshold `countChangedPixels` uses, so a whole frame never crosses the wire.
    const redrawn = await page.evaluate(() => {
      const advance = (window as GameWindow).advanceTime!;
      const gl = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
      const copy = document.createElement('canvas'); copy.width = gl.width; copy.height = gl.height;
      const ctx = copy.getContext('2d', { willReadFrequently: true })!;
      const frame = () => { ctx.clearRect(0, 0, copy.width, copy.height); ctx.drawImage(gl, 0, 0); return ctx.getImageData(0, 0, copy.width, copy.height).data; };
      advance(0, true); const a = frame();
      for (let i = 0; i < 3; i++) advance(0, true);
      const b = frame();
      let changed = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 8) changed++;
      return changed;
    });
    expect(await particles(game), 'a zero-time draw aged the dust').toEqual(held);
    expect(redrawn, 'a zero-time redraw changed the frame').toBe(0);
    await page.keyboard.press('Escape');
    const pausedAt = steps(await game.state());
    await game.step(500);
    expect(await particles(game), 'pausing aged the dust').toEqual(held);
    expect(steps(await game.state())).toEqual(pausedAt);
    await page.keyboard.up(ARROW_KEYS[lanes[0]]);
    await page.keyboard.press('Escape');
    await game.step(16);
    await game.teleport(centre.x, centre.z);
    feet = steps(await game.state());
    expect([feet.active, feet.drawn], 'teleport left old dust on screen').toEqual([0, false]);

    // Through a dash: holding a direction, then dodging - no contact while the dash carries the body.
    await page.keyboard.down(ARROW_KEYS[lanes[0]]);
    await game.step(120);
    await page.keyboard.press('ShiftLeft');
    let dashFrames = 0;
    for (let i = 0; i < 30; i++) {
      const before = steps(await game.state());
      await game.step(16);
      const state = await game.state();
      if (state.player.dashTime <= 0) { if (dashFrames) break; continue; }
      dashFrames++;
      expect(steps(state).contacts, 'a dash frame produced a footfall').toBe(before.contacts);
    }
    expect(dashFrames, 'the dodge never ran').toBeGreaterThan(2);
    await page.keyboard.up(ARROW_KEYS[lanes[0]]);
    await game.step(500);
    feet = steps(await game.state());
    expect([feet.active, feet.drawn], 'dust did not expire after stopping').toEqual([0, false]);

    // Into a wall: once collision has stopped the body, the stride and the contacts stop with it.
    await game.teleport(centre.x, centre.z);
    await page.keyboard.down('ArrowLeft');
    let stopped = await game.state();
    for (let i = 0; i < 30; i++) {
      await game.step(250);
      const now = await game.state();
      const still = Math.hypot(now.player.x - stopped.player.x, now.player.z - stopped.player.z) < 0.001;
      stopped = now;
      if (still) break;
    }
    await game.step(600);
    const pushing = await game.state();
    expect(Math.hypot(pushing.player.x - stopped.player.x, pushing.player.z - stopped.player.z)).toBeLessThan(0.001);
    expect(steps(pushing).contacts, 'pushing a wall kept planting feet').toBe(steps(stopped).contacts);
    expect(steps(pushing).active).toBe(0);
    await page.keyboard.up('ArrowLeft');
  });

  test('hit-stop holds contact dust exactly where it is, and a live blow is captured', async ({ game, page }) => {
    await game.enter();
    await game.step(120);
    const floor = await game.floor();
    const target = roomCentre(floor, ROOMS.keep);
    const stance = strikeStance(floor, target, { distance: 2.6 });
    const opening = await game.state();
    const index = opening.enemies.findIndex(e => e.awake && e.kind === 'guard');
    expect(index, 'no awake guard on the fixture floor to stage a blow with').toBeGreaterThanOrEqual(0);
    await game.teleport(stance.x, stance.z);
    await game.step(16);
    await game.configureCombat({ enemies: [{ index, x: target.x, z: target.z, cooldown: 999, windup: 0 }] });
    await page.keyboard.down(stance.key);
    let struck: Snapshot | null = null, swung = false;
    for (let i = 0; i < 60 && !struck; i++) {
      await game.step(16);
      const state = await game.state();
      if (!swung && Math.hypot(state.player.x - target.x, state.player.z - target.z) < 1.7) { await game.act('attack'); swung = true; }
      if (extra(state).settings.hitStop > 0) struck = state;
    }
    expect(struck, 'the staged blow never landed').not.toBeNull();
    const frozen = await particles(game);
    expect(frozen.length, 'no dust was alive at the blow; the fixture no longer walks into it').toBeGreaterThan(0);
    await game.step(16);
    const during = await game.state();
    expect(extra(during).settings.hitStop, 'the second frame is already out of the hit-stop').toBeGreaterThan(0);
    expect(await particles(game), 'hit-stop aged the dust').toEqual(frozen);
    expect(steps(during).contacts).toBe(steps(struck!).contacts);
    if (CAPTURING) {
      const frames = await footstepFrames(game);
      await captureContact(game, 'footsteps-combat-contact', project(during, frames.width, frames.height, frozen[0]));
    }
    await page.keyboard.up(stance.key);
  });
});

test.describe('the surface decides the feedback', () => {
  test.use({ seeds: [SEED] });

  test('keep and ruins stone raise dust, flooded stone sheds drops, and wood gives nothing', async ({ game, page }) => {
    await game.enter();
    const floor = await game.floor();
    for (const kind of ['keep', 'ruins', 'flooded'] as const) {
      const { centre, lanes } = roomLanes(floor, ROOMS[kind]);
      expect(floor.rooms[ROOMS[kind]].theme).toBe(kind);
      await game.teleport(centre.x, centre.z);
      await game.step(16);
      const before = steps(await game.state());
      await page.keyboard.down(ARROW_KEYS[lanes[0]]);
      await game.step(300);
      const mid = await particles(game);
      await game.step(150);
      await page.keyboard.up(ARROW_KEYS[lanes[0]]);
      const after = steps(await game.state());
      const gained = (k: Kind) => after.kinds[k] - before.kinds[k];
      expect(gained(kind), `${kind}: no contacts classified as ${kind}`).toBeGreaterThan(0);
      for (const other of (['keep', 'ruins', 'flooded'] as const).filter(k => k !== kind)) expect(gained(other), `${kind} stone emitted ${other} feedback`).toBe(0);
      expect(mid.length).toBeGreaterThan(0);
      expect(mid.every((p: FootstepParticle) => p.droplet === (kind === 'flooded')), `${kind}: wrong particle shape`).toBe(true);
      await game.step(400);
    }
    // A bridge: its planks are support, but wood never raises dust or drops.
    const wood = woodCells(floor);
    const bridge = floor.tiles.filter(t => t.wood).flatMap(t => DIRECTIONS.map(d => ({ t, d })))
      .find(({ t, d }) => clearLane(floor, { x: t.x * TILE, z: t.z * TILE }, SCREEN_DIRECTIONS[d], 3.2, k => wood.has(k)));
    expect(bridge, 'the fixture floor has no straight bridge walk any more').toBeDefined();
    await game.teleport(bridge!.t.x * TILE, bridge!.t.z * TILE);
    await game.step(16);
    const before = steps(await game.state());
    await page.keyboard.down(ARROW_KEYS[bridge!.d]);
    await game.step(300);
    await page.keyboard.up(ARROW_KEYS[bridge!.d]);
    const after = steps(await game.state());
    expect(after.contacts - before.contacts, 'the bridge walk planted no footfalls at all').toBeGreaterThan(0);
    expect(after.emitted, 'wood raised dust or drops').toBe(before.emitted);
    expect(after.skipped - before.skipped).toBe(after.contacts - before.contacts);
  });

  test('16 ms steps and one subdivided call give the same footfalls, and repeat runs hold resource counts', async ({ game, page }) => {
    const run = async (walk: () => Promise<void>) => {
      await game.enter();
      const floor = await game.floor();
      const { centre, lanes } = roomLanes(floor, ROOMS.keep);
      await game.teleport(centre.x, centre.z);
      await game.step(16);
      await page.keyboard.down(ARROW_KEYS[lanes[0]]);
      await walk();
      await page.keyboard.up(ARROW_KEYS[lanes[0]]);
      await game.step(500, true);
      const state = await game.state();
      return { feet: steps(state), phase: state.player.locomotion.phase, render: state.render };
    };
    const fine = await run(async () => { for (let i = 0; i < 25; i++) await game.step(16); });
    await game.reset([SEED]);
    const coarse = await run(() => game.step(400));
    expect(fine.feet.contacts).toBeGreaterThan(1);
    expect(Math.abs(fine.feet.contacts - coarse.feet.contacts), 'subdividing the same walk changed its footfalls').toBeLessThanOrEqual(1);
    expect(Math.abs(fine.feet.emitted - coarse.feet.emitted)).toBeLessThanOrEqual(1);
    for (const r of [fine, coarse]) expect(r.feet.contacts).toBe(contactCount(r.phase));
    expect([coarse.feet.active, coarse.feet.drawn]).toEqual([0, false]);
    await game.reset([SEED]);
    const repeat = await run(async () => { for (let i = 0; i < 25; i++) await game.step(16); });
    expect(repeat.feet, 'an identical run did not replay the identical footfalls').toEqual(fine.feet);
    // A leak only ever grows. The first run can hold a couple of geometries more than a run made after
    // `reset`, because it inherits whatever the pooled page had already drawn before this scenario began
    // (three.js uploads geometry the first time it is on screen), so equality would fail on a shrink too.
    expect(repeat.render.geometries, 'repeat runs grew GPU geometries').toBeLessThanOrEqual(fine.render.geometries);
    expect(repeat.render.textures, 'repeat runs grew GPU textures').toBeLessThanOrEqual(fine.render.textures);
  });

  // One scenario per theme on the pooled page, so no single test carries every theme's draws.
  // Flooded is the one on the PR gate: its room is far from the origin, so a stale bounding sphere on the
  // particle batch (culled off screen) fails here. The keep and ruins cases repeat the check nightly.
  for (const kind of ['keep', 'ruins', 'flooded'] as const) test(`a ${kind} contact is on screen at the boot, and its stride is captured for review`, { tag: kind === 'flooded' ? [] : ['@nightly'] }, async ({ game, page }) => {
    await game.enter();
    const floor = await game.floor();
    {
      const { centre, lanes } = roomLanes(floor, ROOMS[kind]);
      await game.teleport(centre.x, centre.z);
      await game.step(SETTLE);
      const key = ARROW_KEYS[lanes[0]];
      await walkToContact(game, key);
      const contact = await footstepFrames(game);
      console.log(`FOOTSTEP ${kind}-contact-instant particles=${contact.particles.length} changed=${contact.changed}px peakDelta=${contact.peak}`);
      const at = project(await game.state(), contact.width, contact.height, contact.particles[0]);
      await captureContact(game, `footsteps-${kind}-contact`, at);
      // The same stride, held: +60/+120/+240 ms after the contact, each drawn and reviewed at native size.
      for (const [ms, label] of [[60, '60'], [60, '120'], [120, '240']] as const) {
        await game.step(ms);
        if (label === '60') {
          const { centre: now } = await provePixels(game, `${kind}-plus60`);
          await captureContact(game, `footsteps-${kind}-plus60`, now);
        } else await game.capture(`footsteps-${kind}-plus${label}`);
      }
      await page.keyboard.up(key);
    }
  });
});

test.describe('footfalls on a phone', () => {
  test.use({ seeds: [SEED], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  /**
   * One isolated context for every phone case (see `needsOwnPage` in helpers.ts): the ordinary look on
   * dry and wet stone, then Reduced motion switched on through the real settings card, and the same
   * two surfaces again. Walking uses the keyboard, which a touch context still delivers, so the stride
   * is the same deterministic input the desktop cases use.
   */
  test('dry and wet contacts read at phone size, and reduced motion keeps one short, nearly still particle', async ({ game, page }) => {
    await game.enter();
    const floor = await game.floor();
    const walkCase = async (kind: 'keep' | 'flooded', label: string, after: number) => {
      const { centre, lanes } = roomLanes(floor, ROOMS[kind]);
      await game.teleport(centre.x, centre.z);
      await game.step(SETTLE);
      const key = ARROW_KEYS[lanes[0]];
      await walkToContact(game, key);
      await game.step(after);
      const proof = await provePixels(game, `${kind}-${label}`);
      await captureContact(game, `footsteps-${kind}-${label}`, proof.centre);
      return key;
    };
    for (const kind of ['keep', 'flooded'] as const) {
      const key = await walkCase(kind, 'phone', 48);
      await page.keyboard.up(key);
      await game.step(400);
    }
    // The real settings card: pause, open Settings, choose Reduced, back to the menu, resume.
    await game.act('pause');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('#set-motion').selectOption('reduce');
    await page.getByRole('button', { name: 'Back' }).click();
    await page.locator('.intro-screen .primary-action').click();
    await expect(page.locator('.intro-screen')).toBeHidden();
    expect(extra(await game.state()).settings.reduceMotion).toBe(true);
    for (const kind of ['keep', 'flooded'] as const) {
      // A reduced fleck lives 0.12 s, so it is looked at one frame after its contact, not three.
      const key = await walkCase(kind, 'phone-reduced', 16);
      const [fleck, ...rest] = await particles(game);
      expect(rest, `${kind}: reduced motion spawned more than one particle`).toEqual([]);
      expect(fleck.life).toBeLessThanOrEqual(REDUCED_FOOTSTEP.life + 1e-6);
      await page.keyboard.up(key);
      for (let i = 0; i < 10; i++) {
        await game.step(16);
        for (const p of await particles(game)) expect(Math.hypot(p.x - p.ox, p.y - p.oy, p.z - p.oz)).toBeLessThanOrEqual(REDUCED_FOOTSTEP.travel + 1e-6);
      }
      await game.step(400);
    }
  });
});
