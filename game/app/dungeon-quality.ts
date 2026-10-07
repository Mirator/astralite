// Adaptive render quality: when the frames a player actually sees come too slowly, step the picture down
// one rung at a time until they do not. Pure (no Three.js, no DOM), so node can hold the rule; the game
// feeds it the interval of every frame it drew during play and applies the rung it lands on.
//
// Before this, only a software rasteriser got the reduced post chain (`postQuality` in dungeon-post.ts).
// Every real GPU - integrated graphics and phones included - ran GTAO and bloom at a pixel ratio of up to
// 1.75, about three times the pixels of 1.0, with nothing to fall back to.

/** One rung of the ladder: whether GTAO and bloom run, and the renderer's pixel ratio. */
export type QualityStage = { ao: boolean; bloom: boolean; pixelRatio: number };

/** The renderer's pixel ratio at full quality, as dungeon-game.tsx has always set it. */
export const MAX_PIXEL_RATIO = 1.75;

/**
 * The rungs from the starting picture down, most expensive loss of fidelity last: GTAO first (its own
 * normal/depth pre-pass, and it scales with every pixel), then the pixel ratio (the biggest single
 * saving), then bloom (the look leans on it, so it goes only when nothing else was enough). A rung that
 * would change nothing - a pixel ratio already at 1, a pass the start already had off - is left out, so a
 * step always does something and the ladder of a software rasteriser, which starts reduced, is short.
 */
export function qualityLadder(start: QualityStage): QualityStage[] {
  const ladder = [start];
  const add = (next: QualityStage) => {
    const last = ladder[ladder.length - 1];
    if (next.ao !== last.ao || next.bloom !== last.bloom || next.pixelRatio !== last.pixelRatio) ladder.push(next);
  };
  add({ ...start, ao: false });
  add({ ao: false, bloom: start.bloom, pixelRatio: Math.min(start.pixelRatio, 1) });
  add({ ao: false, bloom: false, pixelRatio: Math.min(start.pixelRatio, 1) });
  return ladder;
}

/** The pixel ratio the game starts at on a screen of this density. */
export const startPixelRatio = (devicePixelRatio: number) => Math.min(Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1, MAX_PIXEL_RATIO);

/** A window is this much drawn time, summed from the intervals fed in - not wall time, so a pause adds nothing. */
export const WINDOW_MS = 2000;
/** A window's median interval above this is slow: under about 45 frames a second. */
export const SLOW_MS = 22;
/** No one interval counts for more than this towards a window, so a single hitch (a shader compiled on
 * first use, a collection) cannot fill one on its own: a window always holds at least eight frames. */
export const HITCH_CAP_MS = 250;
/** Slow windows in a row before a step: one slow window is a hitch (a floor build, a shader on first use). */
export const SLOW_WINDOWS = 2;

/**
 * What the governor remembers. `rung` indexes the ladder; `settling` drops the first window after a step,
 * which pays for the step itself (render targets reallocated, a resize) and says nothing about the new rung.
 */
export type Governor = { ladder: QualityStage[]; rung: number; samples: number[]; spent: number; slow: number; settling: boolean };

export const createGovernor = (start: QualityStage): Governor => ({ ladder: qualityLadder(start), rung: 0, samples: [], spent: 0, slow: 0, settling: false });

/** The stage the governor is on. */
export const governorStage = (governor: Governor) => governor.ladder[governor.rung];

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Feeds the interval, in milliseconds, between a drawn frame and the animation frame before it. Returns
 * the new stage when this frame closes a window that takes the governor a rung down, and null otherwise.
 * It never steps back up: a rung that was too slow once will be again, and a picture that flickers
 * between two qualities is worse than either. A non-finite or non-positive interval is ignored.
 */
export function observeFrame(governor: Governor, intervalMs: number): QualityStage | null {
  if (!(intervalMs > 0) || !Number.isFinite(intervalMs) || governor.rung >= governor.ladder.length - 1) return null;
  governor.samples.push(intervalMs); governor.spent += Math.min(intervalMs, HITCH_CAP_MS);
  if (governor.spent < WINDOW_MS) return null;
  const slow = median(governor.samples) > SLOW_MS;
  governor.samples = []; governor.spent = 0;
  if (governor.settling) { governor.settling = false; return null; }
  governor.slow = slow ? governor.slow + 1 : 0;
  if (governor.slow < SLOW_WINDOWS) return null;
  governor.rung++; governor.slow = 0; governor.settling = true;
  return governorStage(governor);
}
