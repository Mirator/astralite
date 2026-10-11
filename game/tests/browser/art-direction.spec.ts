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
 * `docs/art-direction.md` makes two claims a screenshot alone cannot settle:
 * that each family burns its own fire, and that the one mark the player answers
 * on a deadline reads against the stone it is drawn on in every family. Only the
 * second is held here now, and only in the keep: the fire check and the ruins and
 * flooded telegraph repeats were `@nightly`, which nothing ran, and were deleted
 * on 2026-10-11. Nothing else measures them; a palette change needs a look by eye.
 *
 * It is measured off the rendered canvas in CIE Lab, not off the constants
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

test.describe('the telegraph reads against its own stone', () => {
  test.use({ seeds: [0x1] });
  // The keep only: the ruins and flooded repeats were @nightly, which nothing ran, and were deleted on 2026-10-11.
  for (const theme of ['keep'] as const) {
    test(`a warden winding up in the ${theme} is legible against the paving`, async ({ game }) => {
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
