// What the result card says about a finished run, kept out of the component so the wording can be tested
// without a browser. The input is the `RunEnd` that `finish` logged, so the card reports what the run
// recorded and never a second opinion.
import { BOONS } from './dungeon-sim.ts';
import type { RunCause, RunEnd } from './dungeon-save.ts';

// A Record, not a switch: a new enemy kind fails to compile here until it has a way to be blamed.
export const CAUSE_LABELS: Record<RunCause, string> = {
  guard: 'Felled by a guard',
  stalker: 'Pounced on by a stalker',
  warden: 'Felled by a warden',
  archer: 'Shot down by an archer',
  shieldbearer: 'Felled by a shieldbearer',
  reaper: 'Reaped by a reaper',
  pyre: 'Burned by a pyre',
  bonecaller: 'Felled by a bonecaller',
  rattler: 'Bitten by a rattler',
  captain: 'Sunk by the Drowned Captain',
  hazard: 'Burned by the keep\u2019s embers',
};

export const formatRunTime = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export type RunSummary = { cause: string | null; time: string; boons: string };

// An id no longer in the table (a save from another version) is shown as the id rather than dropped.
export const summariseRunEnd = (end: Pick<RunEnd, 'won' | 'cause' | 'seconds' | 'boons'>): RunSummary => ({
  cause: end.won || !end.cause ? null : CAUSE_LABELS[end.cause],
  time: formatRunTime(end.seconds),
  boons: end.boons.length ? end.boons.map((id) => BOONS.find((boon) => boon.id === id)?.name ?? id).join(', ') : 'no boons',
});
