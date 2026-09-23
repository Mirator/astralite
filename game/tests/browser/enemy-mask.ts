import type { Page } from '@playwright/test';

/**
 * Plan 011: what each figure in a frame looks like on screen, measured by drawing the frame with the
 * figure and again without it. The pixels that changed are the figure's mask; its mean colour over
 * the mask is read in CIE Lab off the frame it was visible in.
 *
 * The figures are reached through three's own devtools hook rather than through a game hook: three
 * announces every `Scene` it constructs to `__THREE_DEVTOOLS__` when that global exists, so an init
 * script that installs one before boot is handed the live scene and nothing in the game has to know.
 * That is why the page has to be booted after `probeScene` - a pooled page is already running.
 *
 * Only the body is measured. For the pair of frames that make one figure's mask, that figure casts no
 * shadow and its contact pool is hidden, in both frames: the moon throws a figure's shadow most of a
 * tile away, and a mask that included it would be measuring the floor it falls on.
 */

export const probeScene = (page: Page) =>
  page.addInitScript(() => {
    const scenes: unknown[] = [];
    const hub = new EventTarget();
    hub.addEventListener('observe', (event) => {
      const detail = (event as CustomEvent).detail as { isScene?: boolean } | undefined;
      if (detail?.isScene) scenes.push(detail);
    });
    const win = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __probedScenes: unknown[] };
    win.__THREE_DEVTOOLS__ = hub;
    win.__probedScenes = scenes;
  });

export type Mask = {
  name: string;
  pixels: number;
  lab: [number, number, number];
  box: [number, number, number, number];
};

/** Actors to measure: the knight, or the living enemy standing at (x, z). */
export type Target = { name: string; knight?: boolean; x?: number; z?: number };

export const measureMasks = (page: Page, targets: Target[]) =>
  page.evaluate((wanted: Target[]) => {
    type Node = {
      userData: Record<string, unknown>;
      children: Node[];
      visible: boolean;
      position: { x: number; z: number };
      castShadow?: boolean;
      isMesh?: boolean;
      material?: { blending?: number };
    };
    const win = window as unknown as { __probedScenes?: Node[]; advanceTime: (ms: number, draw: boolean) => void };
    const walk = (node: Node, visit: (node: Node) => void) => { visit(node); for (const child of node.children) walk(child, visit); };
    let knight: Node | null = null;
    const enemies: Node[] = [];
    for (const scene of win.__probedScenes ?? []) {
      walk(scene, (node) => {
        if (node.userData.cape && node.userData.torso) knight = node;
        else if (node.userData.skull && node.userData.limbs) enemies.push(node);
      });
      if (knight) break;
    }
    if (!knight) throw new Error('no scene holding the knight was announced to the devtools probe');
    const gl = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
    const copy = document.createElement('canvas');
    copy.width = gl.width; copy.height = gl.height;
    const ctx = copy.getContext('2d', { willReadFrequently: true })!;
    const frame = () => {
      win.advanceTime(0, true);
      ctx.clearRect(0, 0, copy.width, copy.height);
      ctx.drawImage(gl, 0, 0);
      return ctx.getImageData(0, 0, copy.width, copy.height).data;
    };
    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lab = (r: number, g: number, b: number) => {
      const R = lin(r), G = lin(g), B = lin(b);
      const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
      const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
      const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
      const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
    };
    // Eight levels summed over the channels: past dither, as in art-direction.spec.ts.
    const changed = (p: Uint8ClampedArray, q: Uint8ClampedArray, i: number) =>
      Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) >= 8;
    // Two frames with nothing hidden: what a mask would pick up if the scene itself were moving.
    const a = frame(), b = frame();
    let noise = 0;
    for (let i = 0; i < a.length; i += 4) if (changed(a, b, i)) noise++;
    const masks = wanted.map((target) => {
      const actor = target.knight
        ? knight!
        : enemies.find((enemy) => Math.hypot(enemy.position.x - target.x!, enemy.position.z - target.z!) < 0.05);
      if (!actor) throw new Error(`no actor stands where ${target.name} was placed`);
      const casting: Node[] = [], pools: Node[] = [];
      walk(actor, (node) => {
        if (!node.isMesh) return;
        // MultiplyBlending (4) is the contact pool and nothing else on a figure.
        if (node.material?.blending === 4) { if (node.visible) pools.push(node); }
        else if (node.castShadow) casting.push(node);
      });
      casting.forEach((node) => { node.castShadow = false; });
      pools.forEach((node) => { node.visible = false; });
      const shown = frame();
      actor.visible = false;
      const hidden = frame();
      actor.visible = true;
      casting.forEach((node) => { node.castShadow = true; });
      pools.forEach((node) => { node.visible = true; });
      let pixels = 0, L = 0, A = 0, B = 0, x0 = copy.width, y0 = copy.height, x1 = -1, y1 = -1;
      for (let i = 0; i < shown.length; i += 4) {
        if (!changed(shown, hidden, i)) continue;
        const [l, aa, bb] = lab(shown[i], shown[i + 1], shown[i + 2]);
        pixels++; L += l; A += aa; B += bb;
        const p = i / 4, x = p % copy.width, y = Math.floor(p / copy.width);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      const n = Math.max(pixels, 1);
      return { name: target.name, pixels, lab: [L / n, A / n, B / n], box: [x0, y0, x1, y1] };
    });
    frame();
    return { noise, masks };
  }, targets) as Promise<{ noise: number; masks: Mask[] }>;

/** CIE76 distance between two mean colours. */
export const deltaE = (p: [number, number, number], q: [number, number, number]) =>
  Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/**
 * The windup flash, read off the materials themselves: the emissive on the first mesh drawn directly
 * under the rig (a baked batch, after plan 011), under the skull and under the shield arm, for the
 * living enemy standing at (x, z).
 */
export const readFlash = (page: Page, at: { x: number; z: number }) =>
  page.evaluate((point: { x: number; z: number }) => {
    type Node = { userData: Record<string, unknown>; children: Node[]; isMesh?: boolean; position: { x: number; z: number }; material?: { emissive?: { getHex: () => number } } };
    const win = window as unknown as { __probedScenes?: Node[] };
    const walk = (node: Node, visit: (node: Node) => void) => { visit(node); for (const child of node.children) walk(child, visit); };
    let body: Node | null = null;
    for (const scene of win.__probedScenes ?? []) walk(scene, (node) => {
      if (node.userData.skull && node.userData.limbs && Math.hypot(node.position.x - point.x, node.position.z - point.z) < 0.05) body = node;
    });
    if (!body) throw new Error('no enemy stands at the point asked about');
    const found = body as Node;
    const lit = (node: Node) => node.isMesh && node.material?.emissive ? node.material.emissive.getHex() : null;
    const rig = found.userData.rig as Node, skull = found.userData.skull as Node, arm = (found.userData.limbs as Node[])[0];
    const first = (root: Node, direct: boolean) => {
      if (direct) return root.children.map(lit).find((hex) => hex !== null) ?? null;
      let hex: number | null = null;
      walk(root, (node) => { if (hex === null) hex = lit(node); });
      return hex;
    };
    return { rig: first(rig, true), skull: first(skull, false), arm: first(arm, false) };
  }, at);
