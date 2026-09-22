// The pure half of the shot comparison: arguments, the base-ref decision, COST lines, pairing captures by
// name, and the contact sheet's HTML. No file system, no git, no browser - `compare.ts` does the side
// effects and `tests/shots-compare.test.ts` holds this half to its word.
import type { DiffStats } from './diff.ts';

export type Gl = 'd3d11' | 'swiftshader';

export type Options = {
  /** Git ref to capture as the previous side. Undefined with `before` set, or when the default applies. */
  base?: string;
  /** A directory of PNGs to use as the previous side instead of capturing one. */
  before?: string;
  /** A directory of PNGs to use as the current side instead of capturing the working tree. */
  after?: string;
  gl: Gl;
  out?: string;
  gain: number;
  /** Passed to Playwright as `--grep`: it matches test titles, not capture names. */
  grep?: string;
  port: number;
  basePort: number;
  allowMixedGl: boolean;
  help: boolean;
};

export const USAGE = `
  npm run shots:compare                              fork point with main vs the working tree
  npm run shots:compare -- --base <ref>              any commit, branch or tag vs the working tree
  npm run shots:compare -- --before <dir>            an existing directory of PNGs vs the working tree
  npm run shots:compare -- --before <dir> --after <dir>   two directories, no capture at all

  --gl d3d11|swiftshader   renderer for every side this run captures (default d3d11; swiftshader
                           is the one output/shots/baseline was taken on, and about three times slower)
  --gain <n>               amplification of the difference image (default 6)
  --grep <pattern>         only the shots.spec tests whose title matches
  --out <dir>              where the sheet goes (default outputs/shots-compare/<timestamp>)
  --port <n>               dev server for the working tree (default GAME_TEST_PORT or 3000)
  --base-port <n>          dev server for the base worktree (default port + 1)
  --allow-mixed-gl         compare against a directory captured on another renderer anyway
`;

export function parseArgs(argv: string[], env: Record<string, string | undefined> = {}): Options {
  const options: Options = {
    gl: 'd3d11',
    gain: 6,
    port: Number(env.GAME_TEST_PORT ?? 3000),
    basePort: NaN,
    allowMixedGl: false,
    help: false,
  };
  const takes = new Set(['base', 'before', 'after', 'gl', 'out', 'gain', 'grep', 'port', 'base-port']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--allow-mixed-gl') { options.allowMixedGl = true; continue; }
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match || !takes.has(match[1])) throw new Error(`unknown argument ${arg}`);
    const value = match[2] ?? argv[++i];
    if (value === undefined || value === '' || (match[2] === undefined && value.startsWith('--'))) throw new Error(`--${match[1]} needs a value`);
    const number = (name: string) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive number, got ${value}`);
      return parsed;
    };
    switch (match[1]) {
      case 'base': options.base = value; break;
      case 'before': options.before = value; break;
      case 'after': options.after = value; break;
      case 'out': options.out = value; break;
      case 'grep': options.grep = value; break;
      case 'gain': options.gain = number('gain'); break;
      case 'port': options.port = Math.round(number('port')); break;
      case 'base-port': options.basePort = Math.round(number('base-port')); break;
      case 'gl':
        if (value !== 'd3d11' && value !== 'swiftshader') throw new Error(`--gl must be d3d11 or swiftshader, got ${value}`);
        options.gl = value;
        break;
    }
  }
  if (options.base !== undefined && options.before !== undefined) throw new Error('--base and --before both name the previous side; pass one');
  if (!Number.isInteger(options.port) || options.port <= 0) throw new Error(`GAME_TEST_PORT must be a port, got ${env.GAME_TEST_PORT}`);
  if (Number.isNaN(options.basePort)) options.basePort = options.port + 1;
  if (options.basePort === options.port) throw new Error('--base-port must differ from --port');
  return options;
}

/**
 * Which commit "previous" means when nobody said. The fork point with main is what a pull request is reviewed
 * against, so a branch that has fallen behind main is still compared with what it changed rather than with
 * what landed since. On main's own tip there is no fork point to speak of: uncommitted work is compared with
 * HEAD, and a clean tree with the commit before it.
 */
export function defaultBase(input: { head: string; forkPoint: string | null; headParent: string | null; dirty: boolean }) {
  if (!input.forkPoint) throw new Error('no main branch to fork from here; pass --base <ref>');
  if (input.forkPoint !== input.head) return { sha: input.forkPoint, why: 'fork point of HEAD with main' };
  if (input.dirty) return { sha: input.head, why: 'HEAD - the branch is at main, so this compares the uncommitted changes' };
  if (!input.headParent) throw new Error('HEAD is at main with a clean tree and no parent; pass --base <ref>');
  return { sha: input.headParent, why: 'HEAD~1 - the branch is at main with a clean tree' };
}

export type Cost = Record<string, number>;

/** `COST <name> calls=… triangles=…` lines out of a run's stdout, whatever prefixes the reporter put on them. */
export function parseCosts(text: string): Record<string, Cost> {
  const costs: Record<string, Cost> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /(?:^|\s)COST (\S+)((?: \w+=-?\d+(?:\.\d+)?)+)\s*$/.exec(line);
    if (!match) continue;
    const cost: Cost = {};
    for (const pair of match[2].trim().split(' ')) {
      const [key, value] = pair.split('=');
      cost[key] = Number(value);
    }
    costs[match[1]] = cost;
  }
  return costs;
}

/** A frame of one of the strips (`strike-seq-07`) belongs to a group; a still does not. */
export function sequenceOf(name: string) {
  const match = /^(.*-seq)-(\d+)$/.exec(name);
  return match ? { group: match[1], frame: Number(match[2]) } : { group: null, frame: null };
}

export type Pair = { name: string; group: string | null; frame: number | null; before: boolean; after: boolean };

/** Every capture either side has, matched by name: stills first, then each strip in frame order. */
export function pairCaptures(before: string[], after: string[]): Pair[] {
  const strip = (file: string) => file.replace(/\.png$/i, '');
  const a = new Set(before.map(strip)), b = new Set(after.map(strip));
  return [...new Set([...a, ...b])]
    .map((name) => ({ name, ...sequenceOf(name), before: a.has(name), after: b.has(name) }))
    .sort((x, y) =>
      (x.group === null ? 0 : 1) - (y.group === null ? 0 : 1) ||
      (x.group ?? '').localeCompare(y.group ?? '') ||
      (x.frame ?? 0) - (y.frame ?? 0) ||
      x.name.localeCompare(y.name));
}

export type Side = {
  label: string;
  /** What was captured: a git ref and commit, the working tree, or a directory. */
  source: string;
  sha?: string;
  dirty?: boolean;
  gl: Gl | null;
  seconds?: number;
  exitCode?: number | null;
  costs: Record<string, Cost>;
};

export type Row = Pair & {
  /** Paths relative to the sheet, or null where that side has no such capture. */
  beforeSrc: string | null;
  afterSrc: string | null;
  diffSrc: string | null;
  stats: DiffStats | null;
  note?: string;
};

export type Sheet = {
  created: string;
  command: string;
  gain: number;
  before: Side;
  after: Side;
  rows: Row[];
  reference: { crop: string; full: string; region: [number, number, number, number] } | null;
  warnings: string[];
};

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const percent = (stats: DiffStats) => {
  const share = (stats.changed / stats.total) * 100;
  return stats.changed && share < 0.01 ? '<0.01%' : `${share.toFixed(2)}%`;
};

/** `2,495 px (0.36%)`: a handful of pixels is still a change, and a percentage alone rounds it to nothing. */
export const changedText = (stats: DiffStats) =>
  stats.changed ? `${stats.changed.toLocaleString('en-US')} px (${percent(stats)})` : 'identical';

/** `412 → 418 (+6)`, or whatever is known when one side never logged the scene. */
export function costChange(before: Cost | undefined, after: Cost | undefined, key: string) {
  const a = before?.[key], b = after?.[key];
  if (a === undefined && b === undefined) return '';
  if (a === undefined || b === undefined) return `${a ?? '?'} → ${b ?? '?'}`;
  const delta = b - a;
  return `${a} → ${b}${delta ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}`;
}

const statsText = (row: Row) => {
  if (row.note) return row.note;
  if (!row.stats) return 'no diff';
  const s = row.stats;
  return s.changed ? `${changedText(s)} changed, worst ${s.worst}, mean ${s.mean}, box ${JSON.stringify(s.box)}` : 'identical';
};

/** One text line a scene, for the terminal. Strips collapse to one line each. */
export function formatSummary(sheet: Sheet) {
  const lines = ['  scene                          changed              worst  calls               triangles'];
  const stills = sheet.rows.filter((row) => row.group === null);
  for (const row of stills) {
    const changed = row.note ? row.note : row.stats ? changedText(row.stats) : '—';
    lines.push(
      `  ${row.name.padEnd(30)} ${changed.padEnd(20)} ${String(row.stats?.worst ?? '').padEnd(6)} ` +
      `${costChange(sheet.before.costs[row.name], sheet.after.costs[row.name], 'calls').padEnd(19)} ` +
      costChange(sheet.before.costs[row.name], sheet.after.costs[row.name], 'triangles'));
  }
  for (const [group, rows] of groups(sheet.rows)) {
    const diffed = rows.filter((row) => row.stats);
    const moved = diffed.filter((row) => row.stats!.changed);
    const worst = Math.max(0, ...diffed.map((row) => row.stats!.changed / row.stats!.total));
    const unpaired = rows.length - diffed.length;
    lines.push(`  ${`${group} (${rows.length} frames)`.padEnd(30)} ${moved.length}/${diffed.length} frames changed, most ${(worst * 100).toFixed(2)}%${unpaired ? `, ${unpaired} unpaired` : ''}`);
  }
  return lines.join('\n');
}

const groups = (rows: Row[]) => {
  const map = new Map<string, Row[]>();
  for (const row of rows) if (row.group !== null) map.set(row.group, [...(map.get(row.group) ?? []), row]);
  return map;
};

const image = (src: string | null, alt: string, lazy: boolean) =>
  src
    ? `<a href="${escapeHtml(src)}" target="_blank"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${lazy ? ' loading="lazy"' : ''}></a>`
    : `<div class="missing">no capture</div>`;

const rowHtml = (row: Row, sheet: Sheet, lazy: boolean) => {
  const before = sheet.before.costs[row.name], after = sheet.after.costs[row.name];
  const cost = ['calls', 'triangles'].map((key) => [key, costChange(before, after, key)]).filter(([, text]) => text);
  const changed = !!row.stats?.changed || !!row.note || !row.before || !row.after;
  return `
<section class="row${changed ? ' changed' : ''}" id="${escapeHtml(row.name)}">
  <h3>${escapeHtml(row.name)}</h3>
  <p class="stats">${escapeHtml(statsText(row))}${cost.map(([key, text]) => ` · ${key} ${escapeHtml(text)}`).join('')}</p>
  <div class="triple">
    <figure>${image(row.beforeSrc, `${row.name} before`, lazy)}<figcaption>${escapeHtml(sheet.before.label)}</figcaption></figure>
    <figure>${image(row.afterSrc, `${row.name} after`, lazy)}<figcaption>${escapeHtml(sheet.after.label)}</figcaption></figure>
    <figure>${image(row.diffSrc, `${row.name} difference`, lazy)}<figcaption>difference ×${sheet.gain}${row.stats?.changed ? ', change boxed in magenta' : ''}</figcaption></figure>
  </div>
</section>`;
};

const sideHtml = (side: Side) =>
  `<tr><th>${escapeHtml(side.label)}</th><td>${escapeHtml(side.source)}${side.sha ? ` <code>${escapeHtml(side.sha.slice(0, 12))}</code>` : ''}` +
  `${side.dirty ? ' + uncommitted changes' : ''}</td><td>${escapeHtml(side.gl ?? 'renderer unknown')}</td>` +
  `<td>${side.seconds === undefined ? '' : `${side.seconds.toFixed(0)}s`}${side.exitCode ? ` · exit ${side.exitCode}` : ''}</td></tr>`;

/** The whole contact sheet: one page, images by relative path, no scripts, nothing fetched from anywhere. */
export function renderSheet(sheet: Sheet) {
  const stills = sheet.rows.filter((row) => row.group === null);
  const index = stills.map((row) =>
    `<tr${row.stats?.changed || row.note ? ' class="changed"' : ''}><td><a href="#${escapeHtml(row.name)}">${escapeHtml(row.name)}</a></td>` +
    `<td>${escapeHtml(row.note ?? (row.stats ? changedText(row.stats) : '—'))}</td><td>${row.stats?.worst ?? ''}</td>` +
    `<td>${escapeHtml(costChange(sheet.before.costs[row.name], sheet.after.costs[row.name], 'calls'))}</td>` +
    `<td>${escapeHtml(costChange(sheet.before.costs[row.name], sheet.after.costs[row.name], 'triangles'))}</td></tr>`).join('\n');
  const strips = [...groups(sheet.rows)].map(([group, rows]) => {
    const diffed = rows.filter((row) => row.stats);
    const moved = diffed.filter((row) => row.stats!.changed).length;
    const worst = Math.max(0, ...diffed.map((row) => row.stats!.changed / row.stats!.total));
    return `
<details class="strip">
  <summary>${escapeHtml(group)} - ${rows.length} frames, ${moved}/${diffed.length} changed, most ${(worst * 100).toFixed(2)}%</summary>
  ${rows.map((row) => rowHtml(row, sheet, true)).join('\n')}
</details>`;
  }).join('\n');
  const reference = sheet.reference
    ? `<aside class="reference"><a href="${escapeHtml(sheet.reference.full)}" target="_blank"><img src="${escapeHtml(sheet.reference.crop)}" alt="Art-direction concept, main isometric scene"></a>
  <p>Art direction: the concept sheet's main scene (${sheet.reference.region.join(', ')}). <a href="${escapeHtml(sheet.reference.full)}" target="_blank">Full sheet</a>.</p></aside>`
    : '<aside class="reference"><p>No art-direction reference found.</p></aside>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shot comparison</title>
<style>
:root { --bg: #15161a; --panel: #1f2126; --ink: #e6e3dc; --dim: #9a978f; --line: #33353c; --hot: #f0a04b; --warn: #ff6b5e; }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--ink); font: 14px/1.45 system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 4px; }
h3 { font-size: 15px; margin: 0; }
a { color: inherit; }
code { font-size: 12px; color: var(--dim); }
.meta { color: var(--dim); margin: 0 0 12px; }
.top { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 480px); gap: 16px; align-items: start; margin-bottom: 16px; }
.reference { position: sticky; top: 8px; background: var(--panel); border: 1px solid var(--line); padding: 8px; }
.reference img { width: 100%; display: block; }
.reference p { margin: 6px 0 0; color: var(--dim); font-size: 12px; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr.changed td:nth-child(2) { color: var(--hot); }
.warnings { color: var(--warn); margin: 8px 0; padding-left: 18px; }
.row { background: var(--panel); border: 1px solid var(--line); padding: 10px; margin: 0 0 12px; }
.row.changed h3 { color: var(--hot); }
.stats { margin: 2px 0 8px; color: var(--dim); font-variant-numeric: tabular-nums; }
.triple { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
figure { margin: 0; }
figure img { width: 100%; display: block; image-rendering: auto; }
figcaption { color: var(--dim); font-size: 12px; margin-top: 2px; }
.missing { aspect-ratio: 10 / 7; display: grid; place-items: center; border: 1px dashed var(--line); color: var(--dim); }
details.strip { margin: 0 0 12px; }
details.strip > summary { cursor: pointer; padding: 8px 0; font-weight: 600; }
@media (max-width: 900px) { .top { grid-template-columns: 1fr; } .reference { position: static; } .triple { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="top">
<div>
  <h1>Shot comparison</h1>
  <p class="meta">${escapeHtml(sheet.created)} · <code>${escapeHtml(sheet.command)}</code> · judges nothing: look at it.</p>
  <table><tr><th></th><th>captured from</th><th>renderer</th><th>wall time</th></tr>
  ${sideHtml(sheet.before)}
  ${sideHtml(sheet.after)}
  </table>
  ${sheet.warnings.length ? `<ul class="warnings">${sheet.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
  <h2>Stills</h2>
  <table><tr><th>scene</th><th>changed</th><th>worst</th><th>draw calls</th><th>triangles</th></tr>
  ${index}
  </table>
</div>
${reference}
</div>
${stills.map((row) => rowHtml(row, sheet, false)).join('\n')}
${strips}
</body>
</html>
`;
}
