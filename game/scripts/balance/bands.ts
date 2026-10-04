// The pure half of the balance gate: a batch of reports in, a handful of headline numbers out, and those
// numbers held against the checked-in bands in bands.json. Nothing here runs the sim, so the node suite
// can prove the comparison without paying a minute of simulated descents for it; check.ts is the part
// that does the running.
import type { RunReport, Policy } from './sim.ts';
import { DEFAULT_POLICY, FLOORS } from './sim.ts';
import { maxedMeta } from '../../app/dungeon-meta.ts';
import { weaponById } from '../../app/dungeon-weapon.ts';

/**
 * How bands.json spells a policy: the sim's own knobs, an arm by name, and (plan 019) `meta: "max"` for a knight
 * who has bought everything. The flag is resolved here, through dungeon-meta.ts, so the file never carries a
 * hand-written meta that could fall behind the upgrade table.
 */
export type PolicySpec = { dodge?: number; reaction?: number; special?: boolean; weapon?: string; meta?: 'max' };

export function buildPolicy(spec: PolicySpec): Policy {
  const { weapon, meta, ...rest } = spec;
  if (meta !== undefined && meta !== 'max') throw new Error(`unknown meta "${String(meta)}" in a balance policy (only "max" exists)`);
  return { ...DEFAULT_POLICY, ...rest, ...(weapon ? { weapon: weaponById(weapon) } : {}), ...(meta ? { meta: maxedMeta() } : {}) };
}

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
  // Plan 023 (D2): what a run pays, the median over the batch (`pearlsFor`: CHAMBER_PEARLS a fight chamber, the floors, the escape, the bosses and the elites), so the shop's pace is a band like everything else. Left out of a batch whose reports carry no pearls.
  const pearls = reports.flatMap(r => typeof r.pearls === 'number' ? [r.pearls] : []);
  if (pearls.length) summary.medianPearls = median(pearls);
  for (let level = 1; level <= FLOORS; level++) {
    const reached = reports.filter(r => r.floors.length >= level).map(r => r.floors[level - 1]);
    if (!reached.length) continue;
    summary[`floor${level}.deathRate`] = reached.filter(f => f.outcome === 'died').length / reached.length * 100;
    const cleared = reached.filter(f => f.outcome === 'cleared');
    if (cleared.length) summary[`floor${level}.medianHpLeft`] = median(cleared.map(f => f.hpAfter / f.maxHpAfter * 100));
    // Plan 022: the vitality he walked into the stair hall with, over the floors where he reached it.
    const atStair = reached.flatMap(f => typeof f.hpAtStair === 'number' ? [f.hpAtStair] : []);
    if (atStair.length) summary[`floor${level}.medianHpAtStair`] = median(atStair);
    // Plan 024 Stage 0: what ordinary bodies took off him per fight chamber he entered, pooled over the batch (the sum of the damage over the sum of the chambers, not a mean of ratios, so a floor with one chamber does not weigh as much as one with four). Left out when no run on the floor entered a fight chamber.
    const chambers = reached.reduce((sum, f) => sum + (typeof f.chambersEntered === 'number' ? f.chambersEntered : 0), 0);
    if (chambers > 0) summary[`floor${level}.ordinaryDamagePerChamber`] = reached.reduce((sum, f) => sum + (f.ordinaryDamage ?? 0), 0) / chambers;
  }
  // Plan 022: of the floors he died on, the share he died on before the stair hall (D13: at least a third for the default knight). Absent when nobody died.
  const deaths = reports.flatMap(r => r.floors).filter(f => f.outcome === 'died');
  if (deaths.length) summary.deathsBeforeBoss = deaths.filter(f => f.deathsBeforeBoss === 1).length / deaths.length * 100;
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
