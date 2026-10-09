import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { cellKey } from '../../app/dungeon-floor.ts';
import { contactCount } from '../../app/dungeon-footstep-rules.ts';
import { FOOTSTEP_LOOK, REDUCED_FOOTSTEP } from '../../app/dungeon-footsteps.ts';
import { ARROW_KEYS, canStand, CAPTURING, expect, type Floor, type Game, type GameWindow, roomCentre, SCREEN_DIRECTIONS, type ScreenDirection, type Snapshot, test, TILE } from './helpers.ts';


/** Seed 0x5d, level 1: three empty chambers, one per theme (0 keep, the gate; 7 ruins and 12 flooded, both shrines). */
const SEED = 0x5d;
const ROOMS = { keep: 0, ruins: 7, flooded: 12 } as const;
/** Torches lit, water moving, mood settled - before a frame that is going to be looked at. */
const SETTLE = 640;
const DIRECTIONS: ScreenDirection[] = ['right', 'left', 'down', 'up'];

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
/** Every screen direction that walks 4 units straight out of a room's centre on its own stone. */
const roomLanes = (floor: Floor, room: number) => {
  const centre = roomCentre(floor, room);
  const lanes = DIRECTIONS.filter(d => clearLane(floor, centre, SCREEN_DIRECTIONS[d], 4, k => floor.roomByCell.get(k) === room));
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

});

// Nightly: reduced motion's own rules are held by tests/dungeon-footsteps.test.ts, and the flooded desktop case
// proves a contact is on screen on every pull request; this adds the phone aspect and the settings card.
test.describe('footfalls on a phone', { tag: '@nightly' }, () => {
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
