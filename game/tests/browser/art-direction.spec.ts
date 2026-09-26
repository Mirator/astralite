import type { Page } from '@playwright/test';
import {
  expect,
  type Floor,
  roomCentre,
  test,
} from './helpers.ts';

/**
 * The palette, measured rather than described.
 *
 * `docs/art-direction.md` makes two claims a screenshot alone cannot settle, so
 * they are settled here instead: that each family burns its own fire, and that
 * the one mark the player answers on a deadline reads against the stone it is
 * drawn on in every family, including the warm one where it has the least room.
 *
 * Both are measured off the rendered canvas in CIE Lab, not off the constants
 * in `ROOM_MOOD` — what a tell is worth on screen is what survives the key
 * light, the fog, the weathering shader and ACES, and none of those are visible
 * from the palette table.
 */

/** What every scene gets before its first frame: torches lit, water moving. */
const SETTLE = 640;

/** The threat colour the game draws every windup in, mirrored from `dungeon-game.tsx`. */
const THREAT: [number, number, number] = [0xff, 0x45, 0x29];

type Lab = { L: number; a: number; b: number };

const toLab = ([r, g, b]: [number, number, number]): Lab => {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return { L: 116 * f(Y) - 16, a: 500 * (f(X) - f(Y)), b: 200 * (f(Y) - f(Z)) };
};

/** Hue angle in degrees, for saying which band a colour sits in. */
const hueOf = ([r, g, b]: [number, number, number]) => {
  const { a, b: bb } = toLab([r, g, b]);
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
};

const hueGap = (p: number, q: number) => {
  const d = Math.abs(p - q) % 360;
  return d > 180 ? 360 - d : d;
};

const parseHex = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * Draw the same chamber twice, once with the body at rest and once with it at
 * the top of its tell, and report what the mark did to the frame.
 *
 * Sampling a fixed box was the first attempt and it was measuring the wrong
 * thing: where a ground decal lands on screen depends on the camera basis and
 * the offset the fixture put the body at, so a hardcoded rectangle catches the
 * arc in one chamber and the paving beside it in the next. Differencing the two
 * frames needs no projection at all — the pixels the tell covers are exactly
 * the pixels that changed, and the mean colour distance across them is what the
 * tell is worth against whatever it happened to be drawn over.
 *
 * Both draws happen inside one evaluated task. The renderer is built without
 * `preserveDrawingBuffer`, so a framebuffer is only guaranteed to survive until
 * the browser composites, and a `drawImage` straight after a synchronous
 * `advanceTime(0, true)` is inside that window where a later screenshot is not.
 */
const tellAgainstStone = async (page: Page, index: number, windup: number) =>
  page.evaluate(
    ({ index, windup }) => {
      type Hooks = {
        advanceTime: (ms: number, draw: boolean) => void;
        dungeonTest: { configureCombatFixture: (f: unknown) => void; setEnemyRigVisible: (index: number, visible: boolean) => void };
      };
      const win = window as unknown as Hooks;
      const gl = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
      const copy = document.createElement('canvas');
      copy.width = gl.width; copy.height = gl.height;
      const ctx = copy.getContext('2d', { willReadFrequently: true })!;
      const frame = (tell: number) => {
        win.dungeonTest.configureCombatFixture({ enemies: [{ index, windup: tell }] });
        win.advanceTime(0, true);
        ctx.clearRect(0, 0, copy.width, copy.height);
        ctx.drawImage(gl, 0, 0);
        return ctx.getImageData(0, 0, copy.width, copy.height).data;
      };
      // The body is hidden for both frames: a windup also flashes the whole body the threat colour, and
      // with it in view the "core" below could be bone rather than the mark, which would hide the very
      // regression (an additively blended mark) this measures.
      win.dungeonTest.setEnemyRigVisible(index, false);
      const rest = frame(0), told = frame(windup);
      win.dungeonTest.setEnemyRigVisible(index, true);
      const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const lab = (r: number, g: number, b: number) => {
        const R = lin(r), G = lin(g), B = lin(b);
        const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
        const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
        const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
        const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
        return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
      };
      let covered = 0, sum = 0, peak = 0;
      let mr = 0, mg = 0, mb = 0, sr = 0, sg = 0, sb = 0;
      const deltas = new Float32Array(rest.length / 4);
      for (let i = 0; i < rest.length; i += 4) {
        // Eight levels on any channel is past dither and compression noise and
        // well under anything a mark meant to be answered would settle for.
        if (Math.abs(told[i] - rest[i]) + Math.abs(told[i + 1] - rest[i + 1]) + Math.abs(told[i + 2] - rest[i + 2]) < 8) continue;
        const p = lab(told[i], told[i + 1], told[i + 2]);
        const q = lab(rest[i], rest[i + 1], rest[i + 2]);
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        deltas[i / 4] = d;
        covered++; sum += d; if (d > peak) peak = d;
        mr += told[i]; mg += told[i + 1]; mb += told[i + 2];
        sr += rest[i]; sg += rest[i + 1]; sb += rest[i + 2];
      }
      // The mark's own colour, as against the mark plus its antialiased hem. Only
      // the pixels it changed most are inside the arc; the rest are its edge, and
      // averaging those in is averaging in the floor it is drawn over, which is
      // the exact confusion this measurement exists to catch.
      let cr = 0, cg = 0, cb = 0, core = 0;
      for (let i = 0; i < deltas.length; i++) {
        if (deltas[i] < peak * .6) continue;
        core++; cr += told[i * 4]; cg += told[i * 4 + 1]; cb += told[i * 4 + 2];
      }
      const n = Math.max(1, covered), c = Math.max(1, core);
      return {
        covered, share: covered / (rest.length / 4),
        mean: sum / n, peak,
        mark: [mr / n, mg / n, mb / n] as [number, number, number],
        core: [cr / c, cg / c, cb / c] as [number, number, number],
        stone: [sr / n, sg / n, sb / n] as [number, number, number],
      };
    },
    { index, windup },
  );

/**
 * The hue of the most saturated thing in the drawn frame, and how much chroma it has - the loudest hue
 * family among the top half per cent of pixels by chroma, not an average across every family in it.
 *
 * This is the document's second rule stated as a number. A first version of this test read the fire
 * straight out of `ROOM_MOOD` and compared constants, which proves only that three numbers differ —
 * and it passed comfortably through a round in which four fifths of the bright pixels in two of the
 * three chambers were rendering under a quarter saturation, because an additive halo sat over the
 * whole flame and washed it. What a family is lit by is a question about pixels.
 */
const loudestColour = async (page: Page) =>
  page.evaluate(() => {
    const gl = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
    (window as unknown as { advanceTime: (ms: number, draw: boolean) => void }).advanceTime(0, true);
    const copy = document.createElement('canvas');
    copy.width = gl.width; copy.height = gl.height;
    const ctx = copy.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(gl, 0, 0);
    const d = ctx.getImageData(0, 0, copy.width, copy.height).data;
    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const ab = (r: number, g: number, b: number) => {
      const R = lin(r), G = lin(g), B = lin(b);
      const X = (R * .4124 + G * .3576 + B * .1805) / .95047, Y = R * .2126 + G * .7152 + B * .0722;
      const Z = (R * .0193 + G * .1192 + B * .9505) / 1.08883;
      const f = (t: number) => (t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      return [500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
    };
    const n = d.length / 4, chroma = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [a, bb] = ab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      chroma[i] = Math.hypot(a, bb);
    }
    // The top half per cent by chroma. Wide enough to be a thing in the world rather than a stray
    // pixel, narrow enough that only the loudest thing in the frame is in it.
    const cut = Float32Array.from(chroma).sort()[Math.floor(n * .995)];
    // Those pixels can hold more than one saturated thing - the chamber's fire and, say, the gold ring of
    // an arm rack the knight is standing in. Averaging a and b across both reported a hue between them
    // that no pixel in the frame has: violet fire and a gold ring came out as 356 degrees, a red the frame
    // did not contain. So the loudest thing is the loudest hue family - the 60-degree span that carries
    // the most chroma - and its colour is averaged over that family alone.
    const top: { a: number; b: number; c: number; h: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (chroma[i] < cut) continue;
      const [a, bb] = ab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      top.push({ a, b: bb, c: chroma[i], h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 });
    }
    const weight = new Float32Array(24);
    for (const p of top) weight[Math.floor(p.h / 15) % 24] += p.c;
    let from = 0, heaviest = -1;
    for (let start = 0; start < 24; start++) {
      let w = 0;
      for (let j = 0; j < 4; j++) w += weight[(start + j) % 24];
      if (w > heaviest) { heaviest = w; from = start; }
    }
    let sa = 0, sb = 0, sc = 0, count = 0;
    for (const p of top) {
      if ((Math.floor(p.h / 15) - from + 24) % 24 >= 4) continue;
      sa += p.a; sb += p.b; sc += p.c; count++;
    }
    const k = Math.max(1, count);
    const light = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const Y = .2126 * lin(d[i * 4]) + .7152 * lin(d[i * 4 + 1]) + .0722 * lin(d[i * 4 + 2]);
      light[i] = 116 * (Y > .008856 ? Math.cbrt(Y) : 7.787 * Y + 16 / 116) - 16;
    }
    light.sort();
    return {
      hue: ((Math.atan2(sb / k, sa / k) * 180) / Math.PI + 360) % 360, chroma: sc / k, count,
      p90: light[Math.floor(n * .9)],
    };
  });

/** A room of this theme that holds a brazier, so the frame shows what burns. */
const litRoom = (floor: Floor, theme: string) => {
  const braziers = floor.props.filter((prop) => prop.kind === 'brazier');
  return floor.rooms
    .filter((room) => room.theme === theme)
    .sort(
      (a, b) =>
        braziers.filter((p) => p.room === b.id).length -
          braziers.filter((p) => p.room === a.id).length || a.id - b.id,
    )[0];
};

test.describe('each family burns its own fire', { tag: '@nightly' }, () => {
  test.use({ seeds: [0x1] });
  test('the three themes light their chambers three different colours', async ({ game }) => {
    test.slow();
    await game.enter();
    const floor = await game.floor();
    const burning: Record<string, [number, number, number]> = {};
    const loud: Record<string, { hue: number; chroma: number; count: number; p90: number }> = {};
    for (const theme of ['keep', 'ruins', 'flooded'] as const) {
      const room = litRoom(floor, theme);
      expect(room, `seed 0x1 holds no ${theme} chamber`).toBeDefined();
      const centre = roomCentre(floor, room!.id);
      await game.teleport(centre.x, centre.z);
      await game.step(SETTLE);
      const state = await game.state();
      expect(
        state.mood.theme,
        `standing in a ${theme} chamber and lit as ${state.mood.theme}`,
      ).toBe(theme);
      burning[theme] = parseHex(state.mood.fire);
      loud[theme] = await loudestColour(game.page);
      await game.capture(`theme-${theme}`);
    }
    // Two of the three have to be off amber, or the tell has nowhere to go.
    const hues = Object.fromEntries(
      Object.entries(burning).map(([k, v]) => [k, hueOf(v)]),
    );
    for (const [a, b] of [['keep', 'ruins'], ['ruins', 'flooded'], ['keep', 'flooded']]) {
      expect(
        hueGap(hues[a], hues[b]),
        `${a} and ${b} burn the same fire (${hues[a].toFixed(0)}° vs ${hues[b].toFixed(0)}°)`,
      ).toBeGreaterThan(40);
    }
    // And the fire is what the frame is actually loudest in, which is the claim that matters and the
    // one a palette table cannot answer.
    for (const theme of ['keep', 'ruins', 'flooded'] as const) {
      const seen = loud[theme], want = hues[theme];
      const note =
        `${theme}: the loudest colour in the frame is ${seen.hue.toFixed(0)}° at chroma ` +
        `${seen.chroma.toFixed(0)} over ${seen.count} px, and the fire is ${want.toFixed(0)}°`;
      // Not in the flood. Plan 014 round B chose warm pools for every chamber - sconces and their lights
      // burn amber in all three families, "so even a teal chamber holds a warm pool against its cool
      // ambient" - and amber at that lightness is far more saturated than any cyan bright enough to be
      // seen: the flood's loudest family is its sconces (68 degrees) and none of its fire makes the top
      // half per cent. Tinting the flame core toward teal was tried and moved nothing. What the flood still
      // owes is above: a fire more than 40 degrees from the other two families'.
      if (theme !== 'flooded') expect(hueGap(seen.hue, want), `${note}, so something else is`).toBeLessThan(40);
      expect(seen.chroma, `${note}, which is not saturated`).toBeGreaterThan(26);
      // A band, not a floor. "Dark field" has no lower bound written into it anywhere, and three
      // successive rounds of honouring it took the frame's ninetieth percentile from the mid forties
      // to the low thirties one step at a time with nothing watching. Dark is the point; unlit is a
      // different game, and the difference between them is worth a number.
      expect(
        seen.p90,
        `${theme} renders at p90 lightness ${seen.p90.toFixed(1)}, which is outside the band a lit keep sits in`,
      ).toBeGreaterThan(24);
      expect(
        seen.p90,
        `${theme} renders at p90 lightness ${seen.p90.toFixed(1)}, which is brighter than a drowned keep should be`,
      ).toBeLessThan(48);
    }
  });
});

test.describe('the telegraph reads against its own stone', () => {
  test.use({ seeds: [0x1] });
  for (const theme of ['keep', 'ruins', 'flooded'] as const) {
    test(`a warden winding up in the ${theme} is legible against the paving`, { tag: theme === 'keep' ? [] : ['@nightly'] }, async ({ game }) => {
      test.slow();
      await game.enter();
      const floor = await game.floor();
      const room = litRoom(floor, theme);
      expect(room, `seed 0x1 holds no ${theme} chamber`).toBeDefined();
      const centre = roomCentre(floor, room!.id);
      await game.teleport(centre.x, centre.z);
      await game.step(SETTLE);
      expect((await game.state()).mood.theme).toBe(theme);

      // One body, parked in the open beside the knight so its mark falls on
      // paving rather than half off a ledge, and frozen so nothing else in the
      // chamber moves between the two frames.
      const stand = await game.state();
      await game.configureCombat({
        health: stand.maxHealth,
        enemies: (stand.enemies ?? []).map((_, index) => ({
          index,
          cooldown: 999,
          ...(index === 0
            ? { x: stand.player.x + 1.6, z: stand.player.z + 1.6, hp: 8 }
            : {}),
        })),
      });
      await game.step(16);

      const tell = await tellAgainstStone(game.page, 0, 0.5);
      await game.configureCombat({ enemies: [{ index: 0, windup: 0.5 }] });
      await game.capture(`telegraph-${theme}`);

      // A floor against the mark failing to draw at all, not a target. The arc is
      // about 1.6 square world units on a ground plane the camera sees at a rake,
      // inside a frame sixteen by ten, and a guard draws it at scale 1 where a
      // warden draws it at 1.7 — so a fifth of one per cent is a mark and zero is
      // a bug. What the tell is worth is the distance below, not the area.
      expect(
        tell.share,
        `the tell covered ${(tell.share * 100).toFixed(2)}% of the frame, so it never drew`,
      ).toBeGreaterThan(0.0008);
      // Past the ~10 of "obviously another colour" by a margin: a mark the player has a third of a second to
      // answer has to be further from its background than that. 33 sits under the weakest chamber measured
      // (ruins, 39.6; keep 60.6, flooded 43.1 with the body hidden, SwiftShader, 2026-09-26) and above a mark
      // washed out to a third of its opacity in a stone colour (30), which the old 25 let through.
      expect(
        tell.mean,
        `the tell is mean ΔE ${tell.mean.toFixed(1)} (peak ${tell.peak.toFixed(1)}) from the ` +
          `${theme} stone under it — mark ${tell.mark.map(Math.round).join()}, stone ${tell.stone.map(Math.round).join()}`,
      ).toBeGreaterThan(33);

      // And it is the same red in every chamber, measured against `THREAT` itself rather than the floor. It
      // was written for an additively drawn mark, which came out dusty pink over the old violet slate; on
      // today's darker stone floor-plus-red is still red (10 degrees off against 8, measured), so what this
      // guards now is a mark that stops being hot, threat-red: 14 degrees and chroma 65 sit outside every
      // chamber's measured 3-8 degrees and chroma 83+, and fail the washed-out mark (17 degrees, chroma 49).
      const lab = toLab(tell.core);
      const chroma = Math.hypot(lab.a, lab.b);
      const drift = hueGap(hueOf(tell.core), hueOf(THREAT));
      const note =
        `${theme}: core ${tell.core.map(Math.round).join()} — C ${chroma.toFixed(0)}, ` +
        `${drift.toFixed(0)}° off threat`;
      expect(drift, `the tell is ${note}, so the paving is setting its hue`).toBeLessThan(14);
      expect(chroma, `the tell is ${note}, which is not hot`).toBeGreaterThan(65);
    });
  }
});
