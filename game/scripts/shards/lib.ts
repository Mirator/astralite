// Splitting the browser suite across CI machines by how long each spec takes, not by how many tests
// it holds. Playwright's own `--shard` cuts the test list into equal-count runs in file order, so
// specs that are both heavy and alphabetically adjacent (footsteps, frame-budget, gameplay, loading,
// models) all land on one machine while another sits idle - 9.2 minutes against 1.8 on the last run.
// Pure: node imports it straight from the unit suite, no Playwright or file system involved.

/** Seconds each spec file spends on the PR gate, keyed by file name (`aim.spec.ts`). */
export type Durations = Record<string, number>;

/** Code-unit order, never `localeCompare`: a Czech locale sorts "ch" after "h", and every CI job must
 * compute the same split as a developer's machine does. */
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Longest-first greedy assignment: every spec goes to whichever shard is currently lightest, heaviest
 * specs first. Deterministic - ties break on file name, then on shard order - so every CI job computes
 * the same split independently. A spec missing from `durations` weighs the median of the known ones,
 * so a new file lands somewhere sensible until the durations are next refreshed.
 */
export function planShards(files: string[], durations: Durations, total: number): string[][] {
  if (!Number.isInteger(total) || total < 1) throw new Error(`shard count must be a positive integer, got ${total}`);
  const known = Object.values(durations).filter((s) => Number.isFinite(s) && s >= 0).sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weight = (file: string) => {
    const seconds = durations[file];
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : fallback;
  };
  const bins = Array.from({ length: total }, () => ({ load: 0, files: [] as string[] }));
  const ordered = [...new Set(files)].sort((a, b) => weight(b) - weight(a) || byName(a, b));
  for (const file of ordered) {
    let lightest = bins[0];
    for (const bin of bins) if (bin.load < lightest.load) lightest = bin;
    lightest.files.push(file);
    lightest.load += weight(file);
  }
  return bins.map((bin) => bin.files.sort(byName));
}

/**
 * Per-spec seconds summed from Playwright `list` reporter output - the lines a CI job log already
 * holds, such as `✓  12 [chromium] › tests/browser/aim.spec.ts:18:1 › title (22.0s)`. Skipped tests
 * print no duration and count nothing. Minutes and milliseconds are converted.
 */
export function parseDurations(log: string): Durations {
  const totals: Durations = {};
  const line = /[✓✘]\s+\d+\s+\[\w+\]\s+›\s+tests[\\/]browser[\\/]([\w.-]+\.spec\.ts):\d+:\d+\s+›.*\((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/;
  for (const raw of log.split(/\r?\n/)) {
    const match = line.exec(raw);
    if (!match) continue;
    const [, file, value, unit] = match;
    const seconds = Number(value) * (unit === 'm' ? 60 : unit === 'ms' ? 0.001 : 1);
    totals[file] = (totals[file] ?? 0) + seconds;
  }
  for (const file of Object.keys(totals)) totals[file] = Math.round(totals[file] * 10) / 10;
  return totals;
}
