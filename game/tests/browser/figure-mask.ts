import type { Page } from '@playwright/test';
import { expect, type Game, type GameWindow, type Point, speedOf, WARM_UP } from './helpers.ts';

/**
 * A figure's own pixels, found by drawing the same frame twice - once with the figure and once without
 * it - and keeping what changed (plan 010; the tell test in `art-direction.spec.ts` is the same idea).
 *
 * "Without it" is not `visible = false`. A hidden mesh leaves the shadow map too, so the moon's shadow
 * and the patch of floor it darkens would change with it and land in the mask. Instead every mesh of
 * the figure is drawn with a clone of its own material that writes neither colour nor depth: the
 * shadow pass (which uses its own depth material and the mesh's own flags) is untouched, the floor
 * behind draws where the figure stood, and the only pixels that differ are the figure's own. The
 * multiply-blended contact pool under an actor is left drawn in both frames, for the same reason.
 *
 * Both draws and both reads happen inside one evaluated task: the renderer does not preserve its
 * drawing buffer, so a `drawImage` straight after a synchronous `advanceTime(0, true)` is inside the
 * window where the frame still exists.
 *
 * The scene is reached through three's own devtools hook - `new Scene()` announces itself to
 * `window.__THREE_DEVTOOLS__` when one is installed - so nothing in the game grows a test hook for
 * this. The hook has to be in place before the game builds its scene, which means an init script and
 * a reload; a spec that uses this runs on its own page (`test.use({ isolate: true })`).
 */

type Probe = Window & { __THREE_DEVTOOLS__?: EventTarget; __figureScenes?: unknown[] };

/** Install the devtools hook and reload, then wait for the game exactly as `Game.open` does. */
export async function probeScenes(game: Game) {
  const page = game.page;
  await page.addInitScript(() => {
    const probe = window as Probe;
    const scenes: unknown[] = [];
    probe.__figureScenes = scenes;
    const hub = new EventTarget();
    hub.addEventListener('observe', (event) => {
      const detail = (event as CustomEvent).detail as { isScene?: boolean };
      if (detail?.isScene) scenes.push(detail);
    });
    probe.__THREE_DEVTOOLS__ = hub;
  });
  await page.reload();
  await page.waitForFunction(() => typeof (window as GameWindow).render_game_to_text === 'function', undefined, { timeout: WARM_UP });
  await page.locator('.loading-veil').waitFor({ state: 'detached', timeout: WARM_UP });
  await game.step(0);
  expect(
    await page.evaluate(() => ((window as Probe).__figureScenes ?? []).length),
    'three never announced a scene to the devtools hook',
  ).toBeGreaterThan(0);
}

/**
 * The same settle `shots.spec.ts` gives the models scenes: tap the keys for a facing, put the knight
 * back on the mark, and let the camera converge. Duplicated rather than imported, since a spec file is
 * not a module other specs load.
 */
export async function settleFacing(game: Game, at: Point, keys: string[]) {
  const page = game.page;
  await game.teleport(at.x, at.z);
  for (const held of keys) await page.keyboard.down(held);
  await game.step(32);
  for (const held of keys) await page.keyboard.up(held);
  await game.step(200);
  await game.teleport(at.x, at.z);
  await game.step(500);
  const state = await game.state();
  expect(state.player.x, 'the knight did not settle on the mark').toBeCloseTo(at.x, 3);
  expect(state.player.z, 'the knight did not settle on the mark').toBeCloseTo(at.z, 3);
  expect(speedOf(state), 'the knight was still moving at frame zero').toBeLessThan(0.01);
}

export type FigureLightness = {
  /** Pixels in the whole figure's mask (held arm included), and its bounding box on the canvas. */
  pixels: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  /** CIE L* percentiles over the whole figure's mask. */
  p25: number;
  p75: number;
  /** Median L* of the ring 6-14 px outside the figure's bounding box, in the frame with the figure. */
  surround: number;
  /**
   * Median L* of the top third of rows (the head) and the middle third (shoulders and chest) of the
   * body's mask - the figure less the arm in his hand. The blade is the palest thing on him by design
   * and lies across the middle third in most facings, so left in it decides "head over shoulders" by
   * where the sword happens to point.
   */
  top: number;
  middle: number;
  /** With `dump`: the frame with the body's mask painted green (the arm's half green), as a PNG data URL. */
  image?: string;
};

/**
 * The knight's lightness against the frame he is drawn in. The page must have been through
 * `probeScenes`. Three draws in one task: the whole figure, the held arm alone, and nothing.
 */
export const knightLightness = (page: Page, dump = false) =>
  page.evaluate((dump: boolean): FigureLightness => {
    type Material = { blending: number; clone: () => Material; colorWrite: boolean; depthWrite: boolean };
    type Node = {
      isMesh?: boolean; userData: Record<string, unknown>; material: Material;
      traverse: (visit: (node: Node) => void) => void;
    };
    const win = window as unknown as Probe & { advanceTime: (ms: number, draw: boolean) => void };
    let knight: Node | undefined;
    for (const scene of (win.__figureScenes ?? []) as Node[]) {
      scene.traverse((node) => { if (!knight && node.userData.armed && node.userData.sword) knight = node; });
    }
    if (!knight) throw new Error('no knight in any scene three announced');
    const held = new Set<Node>();
    (knight.userData.armed as { group: Node }).group.traverse((node) => { if (node.isMesh) held.add(node); });
    // MultiplyBlending is 4 in three; the contact pool is the only multiply-blended mesh on a figure.
    const parts: Node[] = [];
    knight.traverse((node) => { if (node.isMesh && node.material.blending !== 4) parts.push(node); });
    const own = parts.map((part) => part.material);
    const blind = new Map<Material, Material>();
    const ghost = (material: Material) => {
      let clone = blind.get(material);
      if (!clone) {
        clone = material.clone();
        clone.colorWrite = false; clone.depthWrite = false;
        blind.set(material, clone);
      }
      return clone;
    };

    const gl = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
    const copy = document.createElement('canvas');
    copy.width = gl.width; copy.height = gl.height;
    const ctx = copy.getContext('2d', { willReadFrequently: true })!;
    const frame = (drawn: (part: Node) => boolean) => {
      parts.forEach((part, i) => { part.material = drawn(part) ? own[i] : ghost(own[i]); });
      try {
        win.advanceTime(0, true);
        ctx.clearRect(0, 0, copy.width, copy.height);
        ctx.drawImage(gl, 0, 0);
        return ctx.getImageData(0, 0, copy.width, copy.height).data;
      } finally { parts.forEach((part, i) => { part.material = own[i]; }); }
    };
    const seen = frame(() => true), arm = frame((part) => held.has(part)), gone = frame(() => false);
    // Put the frame the page shows back to the one with him in it.
    win.advanceTime(0, true);

    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lightness = (d: Uint8ClampedArray, i: number) => {
      const Y = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      return 116 * (Y > 0.008856 ? Math.cbrt(Y) : 7.787 * Y + 16 / 116) - 16;
    };
    const w = copy.width, h = copy.height;
    // Eight levels summed over R+G+B: past dither, well under any edge of a figure.
    const differs = (a: Uint8ClampedArray, b: Uint8ClampedArray, i: number) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) >= 8;
    const maskOf = (without: Uint8ClampedArray) => {
      const mask = new Uint8Array(w * h), box = { x0: w, y0: h, x1: -1, y1: -1 };
      let pixels = 0;
      for (let p = 0; p < w * h; p++) {
        if (!differs(seen, without, p * 4)) continue;
        mask[p] = 1; pixels++;
        const x = p % w, y = (p / w) | 0;
        box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x); box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
      }
      return { mask, box, pixels };
    };
    // The figure: what changed when all of him went. The body: what changed when all but the arm in his
    // hand went - so where the arm is in front of him it is not body, and where he is in front of it, it is.
    const figure = maskOf(gone), body = maskOf(arm);
    if (!figure.pixels || !body.pixels) throw new Error('hiding the knight changed no pixel');
    const pick = (values: number[], q: number) => { values.sort((a, b) => a - b); return values[Math.min(values.length - 1, Math.floor(values.length * q))]; };
    const all: number[] = [], top: number[] = [], middle: number[] = [], ring: number[] = [];
    const { x0, y0, x1, y1 } = figure.box;
    for (let p = 0; p < w * h; p++) if (figure.mask[p]) all.push(lightness(seen, p * 4));
    const b = body.box, third = (b.y1 - b.y0 + 1) / 3;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      const p = y * w + x;
      if (!body.mask[p]) continue;
      if (y < b.y0 + third) top.push(lightness(seen, p * 4)); else if (y < b.y0 + 2 * third) middle.push(lightness(seen, p * 4));
    }
    for (let y = Math.max(0, y0 - 14); y <= Math.min(h - 1, y1 + 14); y++) for (let x = Math.max(0, x0 - 14); x <= Math.min(w - 1, x1 + 14); x++) {
      if (Math.max(x0 - x, x - x1, y0 - y, y - y1) < 6) continue;
      ring.push(lightness(seen, (y * w + x) * 4));
    }
    let image: string | undefined;
    if (dump) {
      const paint = ctx.createImageData(w, h);
      for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        paint.data[i] = seen[i]; paint.data[i + 1] = body.mask[p] ? 255 : figure.mask[p] ? 128 : seen[i + 1]; paint.data[i + 2] = seen[i + 2]; paint.data[i + 3] = 255;
      }
      ctx.putImageData(paint, 0, 0);
      image = copy.toDataURL();
    }
    return {
      pixels: figure.pixels, box: figure.box,
      p25: pick(all.slice(), 0.25), p75: pick(all, 0.75),
      surround: pick(ring, 0.5), top: pick(top, 0.5), middle: pick(middle, 0.5), image,
    };
  }, dump);

export type PartRead = {
  /** Pixels where this material is the front-most thing on him: what changed when it alone went. */
  pixels: number;
  /** Median CIE L* over those pixels, in the frame with him in it. */
  L: number;
  /** Share of those pixels with any channel at 254 or over: lit to the top of the range. */
  clipped: number;
};
export type KnightRead = {
  /** The body (everything but the arm in his hand): pixel count and the share at the top of the range. */
  body: { pixels: number; clipped: number };
  /** One entry per material name on the knight (`makeKnight` names each after its palette key). */
  parts: Record<string, PartRead>;
  /**
   * Where two materials meet: for each requested pair [a, b], the median L* of a's pixels within 3 px of
   * one of b's, and of b's within 3 px of one of a's, and how many pixels each side has. This is the chin
   * when the pair is skin and cowl - what decides whether the face stands out of the cloth round it.
   */
  edges: { a: string; b: string; La: number; Lb: number; na: number; nb: number }[];
  image?: string;
};

/**
 * The knight's own rendered values, per material (plan 028). Same technique as `knightLightness`: each
 * mask is what changed when a set of his meshes was drawn with a material that writes neither colour nor
 * depth, so occlusion, the shadow map and the floor behind him are all the game's own. One draw for the
 * frame, one for the body, one per material: about a dozen draws in one task. The page must have been
 * through `probeScenes`.
 */
export const knightRead = (page: Page, pairs: [string, string][] = [], dump = false) =>
  page.evaluate(({ pairs, dump }): KnightRead => {
    type Material = { name: string; blending: number; clone: () => Material; colorWrite: boolean; depthWrite: boolean };
    type Node = { isMesh?: boolean; userData: Record<string, unknown>; material: Material; traverse: (visit: (node: Node) => void) => void };
    const win = window as unknown as Probe & { advanceTime: (ms: number, draw: boolean) => void };
    let knight: Node | undefined;
    for (const scene of (win.__figureScenes ?? []) as Node[]) scene.traverse((node) => { if (!knight && node.userData.armed && node.userData.sword) knight = node; });
    if (!knight) throw new Error('no knight in any scene three announced');
    const held = new Set<Node>();
    (knight.userData.armed as { group: Node }).group.traverse((node) => { if (node.isMesh) held.add(node); });
    const parts: Node[] = [];
    knight.traverse((node) => { if (node.isMesh && node.material.blending !== 4) parts.push(node); });
    const own = parts.map((part) => part.material);
    const blind = new Map<Material, Material>();
    const ghost = (material: Material) => {
      let clone = blind.get(material);
      if (!clone) { clone = material.clone(); clone.colorWrite = false; clone.depthWrite = false; blind.set(material, clone); }
      return clone;
    };
    const gl = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
    const copy = document.createElement('canvas');
    copy.width = gl.width; copy.height = gl.height;
    const ctx = copy.getContext('2d', { willReadFrequently: true })!;
    const frame = (drawn: (part: Node, i: number) => boolean) => {
      parts.forEach((part, i) => { part.material = drawn(part, i) ? own[i] : ghost(own[i]); });
      try { win.advanceTime(0, true); ctx.clearRect(0, 0, copy.width, copy.height); ctx.drawImage(gl, 0, 0); return ctx.getImageData(0, 0, copy.width, copy.height).data; }
      finally { parts.forEach((part, i) => { part.material = own[i]; }); }
    };
    const w = copy.width, h = copy.height;
    const seen = frame(() => true);
    const differs = (b: Uint8ClampedArray, i: number) => Math.abs(seen[i] - b[i]) + Math.abs(seen[i + 1] - b[i + 1]) + Math.abs(seen[i + 2] - b[i + 2]) >= 8;
    const maskOf = (without: Uint8ClampedArray) => { const mask = new Uint8Array(w * h); for (let p = 0; p < w * h; p++) if (differs(without, p * 4)) mask[p] = 1; return mask; };
    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lightness = (i: number) => { const Y = 0.2126 * lin(seen[i]) + 0.7152 * lin(seen[i + 1]) + 0.0722 * lin(seen[i + 2]); return 116 * (Y > 0.008856 ? Math.cbrt(Y) : 7.787 * Y + 16 / 116) - 16; };
    const top = (i: number) => seen[i] >= 254 || seen[i + 1] >= 254 || seen[i + 2] >= 254;
    const median = (values: number[]) => { if (!values.length) return NaN; values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)]; };
    const body = maskOf(frame((part) => held.has(part)));
    const names = [...new Set(own.map((m, i) => (held.has(parts[i]) ? '' : m.name)).filter(Boolean))];
    const masks: Record<string, Uint8Array> = {};
    for (const name of names) masks[name] = maskOf(frame((part, i) => held.has(part) || own[i].name !== name));
    win.advanceTime(0, true);
    const read = (mask: Uint8Array): PartRead => {
      const values: number[] = []; let clipped = 0;
      for (let p = 0; p < w * h; p++) if (mask[p]) { values.push(lightness(p * 4)); if (top(p * 4)) clipped++; }
      return { pixels: values.length, L: median(values), clipped: values.length ? clipped / values.length : 0 };
    };
    const near = (from: Uint8Array, to: Uint8Array) => {
      const values: number[] = [];
      for (let p = 0; p < w * h; p++) {
        if (!from[p]) continue;
        const x = p % w, y = (p / w) | 0; let hit = false;
        for (let dy = -3; dy <= 3 && !hit; dy++) for (let dx = -3; dx <= 3 && !hit; dx++) { const q = (y + dy) * w + x + dx; if (y + dy >= 0 && y + dy < h && x + dx >= 0 && x + dx < w && to[q]) hit = true; }
        if (hit) values.push(lightness(p * 4));
      }
      return values;
    };
    const whole = read(body);
    const out: KnightRead = { body: { pixels: whole.pixels, clipped: whole.clipped }, parts: {}, edges: [] };
    for (const name of names) out.parts[name] = read(masks[name]);
    for (const [a, b] of pairs) {
      if (!masks[a] || !masks[b]) throw new Error(`no material named ${!masks[a] ? a : b} on the knight`);
      const sa = near(masks[a], masks[b]), sb = near(masks[b], masks[a]);
      out.edges.push({ a, b, na: sa.length, nb: sb.length, La: median(sa), Lb: median(sb) });
    }
    if (dump) {
      const paint = ctx.createImageData(w, h);
      for (let p = 0; p < w * h; p++) { const i = p * 4; paint.data[i] = seen[i]; paint.data[i + 1] = seen[i + 1]; paint.data[i + 2] = seen[i + 2]; paint.data[i + 3] = 255; }
      ctx.putImageData(paint, 0, 0); out.image = copy.toDataURL();
    }
    return out;
  }, { pairs, dump });
