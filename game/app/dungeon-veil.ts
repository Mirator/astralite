// The loading veil's bar as a pure rule, so node can check it. A stage is only a name the veil shows; how
// far the bar has run is measured work - texture bands done, shader programs linked - weighted by how long
// each stage takes.
export const VEIL_STAGES = ['Charting the halls', 'Cutting the stone', 'Raising the walls', 'Lighting the braziers', 'Flooding the halls'] as const;

// Each stage's share of a cold load, from plan 015's probe (GTX 1660 SUPER, d3d11, cold shader cache): the
// generator a few ms, the texture bands ~130 ms, the sliced floor build ~200 ms, the shader precompile and
// first frame ~2.7 s, the second frame a few tens of ms. Cold, because that is the load a bar exists for -
// a first visit, or the first after a deploy that touched a shader; a warm load is about a second and reads
// fine at any weighting.
export const VEIL_WEIGHTS = [0.02, 0.05, 0.08, 0.82, 0.03] as const;

// Within the shader stage: the scene's programs are almost all of it, the post chain's a little, and the
// sliced first frame links whatever is left.
export const SHADER_SCENE = 0.85, SHADER_POST = 0.92;

/** How far the bar stands `fraction` of the way through `stage`. Past the last stage is done. */
export const veilProgress = (stage: number, fraction = 0): number => {
  if (!(stage >= 0)) return 0;
  if (stage >= VEIL_WEIGHTS.length) return 1;
  const at = Math.floor(stage);
  let before = 0;
  for (let i = 0; i < at; i++) before += VEIL_WEIGHTS[i];
  const part = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return Math.min(1, before + VEIL_WEIGHTS[at] * part);
};

/**
 * Linked programs as a share of the shader stage, between `from` and `to`. The list grows while the stage
 * runs (the post chain and the first frame add programs), so a share can fall; the caller keeps the bar's
 * maximum, which is what stops it running backwards.
 */
export const programsShare = (ready: number, total: number, from: number, to: number) =>
  total > 0 ? from + (to - from) * Math.min(1, Math.max(0, ready / total)) : from;

/**
 * Parallel links land in batches: measured on a cold load, the count sat still for 1.3 s and then jumped a
 * third of the bar. While it sits still the bar creeps from the measured share towards the end of the step
 * being measured - quickly at first, then ever slower - and covers at most `reach` of that gap, so it keeps
 * moving without ever claiming the step is done. A new measurement resets `stalledMs` and takes over.
 */
export const creep = (measured: number, stepEnd: number, stalledMs: number, tauMs = 1500, reach = 0.6) =>
  measured + Math.max(0, stepEnd - measured) * reach * (1 - Math.exp(-Math.max(0, stalledMs) / tauMs));
