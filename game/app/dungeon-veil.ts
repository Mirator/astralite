// What the loading veil reports while `stagedBuild` raises a keep. Pure, so the node suite can hold the
// counter and the bar to one number.

/** Plan 014 round C: what the veil says is happening, one label per stage of `stagedBuild`. The label
 *  shown is the stage now running, so index 0 names the first one before it has finished. */
export const VEIL_STAGES = ['Charting the halls', 'Cutting the stone', 'Raising the walls', 'Lighting the braziers', 'Flooding the halls'] as const;

/**
 * The label, the "step / total" counter and the bar's fill for `finished` stages done (0 is "not
 * started", `VEIL_STAGES.length` is all of them). The counter names the step now running, and the bar
 * fills to the end of that step, so "3 / 5" is three fifths of the bar. They used to disagree by a whole
 * step - the counter read the running step while the bar read the finished ones - and "3 / 5" drew at 40%.
 */
export const veilProgress = (finished: number) => {
  const total = VEIL_STAGES.length, step = Math.min(Math.max(Math.floor(finished), 0) + 1, total);
  return { label: VEIL_STAGES[step - 1], step, total, fill: step / total };
};
