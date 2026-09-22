// The pure half of the balance gate: a batch of reports in, a handful of headline numbers out, and those
// numbers held against the checked-in bands in bands.json. Nothing here runs the sim, so the node suite
// can prove the comparison without paying a minute of simulated descents for it; check.ts is the part
// that does the running.
import type { RunReport } from './sim.ts';
import { FLOORS } from './sim.ts';

/** Inclusive on both ends. */
export type Band = { min: number; max: number };
/** Metric name to value. A metric the batch could not measure is absent, never zero. */
export type Summary = Record<string, number>;
export type Violation = { policy: string; metric: string; measured: number | null; band: Band; reason: 'below' | 'above' | 'missing' };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * The same definitions main.ts prints, so a failing gate can be read against `npm run balance`: rates and
 * HP are percentages, death rate is of the runs that reached the floor, HP left is over the floors that
 * were cleared, and run length is every run's seconds. A floor nobody reached, or nobody cleared, leaves
 * its metric out - a keep that kills everyone on floor two must not pass floor three's bands by default.
 */
export function summarise(reports: RunReport[]): Summary {
  const summary: Summary = {};
  if (!reports.length) return summary;
  summary.escapeRate = reports.filter(r => r.outcome === 'escaped').length / reports.length * 100;
  summary.medianRunSeconds = median(reports.map(r => r.seconds));
  for (let level = 1; level <= FLOORS; level++) {
    const reached = reports.filter(r => r.floors.length >= level).map(r => r.floors[level - 1]);
    if (!reached.length) continue;
    summary[`floor${level}.deathRate`] = reached.filter(f => f.outcome === 'died').length / reached.length * 100;
    const cleared = reached.filter(f => f.outcome === 'cleared');
    if (cleared.length) summary[`floor${level}.medianHpLeft`] = median(cleared.map(f => f.hpAfter / f.maxHpAfter * 100));
  }
  return summary;
}

/** Every band the policy declares, checked. A band with nothing measured against it is a violation. */
export function compareBands(policy: string, summary: Summary, bands: Record<string, Band>): Violation[] {
  const violations: Violation[] = [];
  for (const [metric, band] of Object.entries(bands)) {
    const measured = summary[metric];
    if (typeof measured !== 'number' || !Number.isFinite(measured)) violations.push({ policy, metric, measured: null, band, reason: 'missing' });
    else if (measured < band.min) violations.push({ policy, metric, measured, band, reason: 'below' });
    else if (measured > band.max) violations.push({ policy, metric, measured, band, reason: 'above' });
  }
  return violations;
}

export const describeViolation = (v: Violation) =>
  `${v.policy}: ${v.metric} ${v.measured === null ? 'was not measured' : `measured ${v.measured.toFixed(1)}, ${v.reason}`} band [${v.band.min}, ${v.band.max}]`;
