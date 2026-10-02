import { parseRun, type RunEnd } from './dungeon-save.ts';

// What a playtester pastes to the developer: the finished-run records and nothing else. No settings, no key
// bindings, no browser or device data - the envelope names the format so a pasted blob can be recognised.
export const RUN_EXPORT_FORMAT = 'astralite-runs';
export const RUN_EXPORT_VERSION = 1;

export type RunExport = { format: typeof RUN_EXPORT_FORMAT; version: typeof RUN_EXPORT_VERSION; exported: string; runs: RunEnd[] };

// Every record is rebuilt field by field through `parseRun`, so a record that grew an extra field in
// memory can never carry it out. A record that fails the parse would be a bug upstream and is dropped.
export const buildRunExport = (runs: readonly RunEnd[], now: Date): RunExport =>
  ({ format: RUN_EXPORT_FORMAT, version: RUN_EXPORT_VERSION, exported: now.toISOString(), runs: runs.map(parseRun).filter((end): end is RunEnd => end !== null) });

export const serialiseRunExport = (runs: readonly RunEnd[], now: Date): string => JSON.stringify(buildRunExport(runs, now), null, 1);

// Plan 019 added `arm`, `upgrades` and `pearls`. An export written before then has none of the three, and
// `parseRun` fills them in; so a record is held to "survives the parse unchanged" after the same defaults
// are appended to it, in the order `parseRun` writes them. A record that has some of them, or has them
// wrong, still differs and still rejects the paste.
const withDefaults = (record: unknown, parsed: RunEnd) => {
  if (!record || typeof record !== 'object') return record;
  const out: Record<string, unknown> = { ...record };
  for (const key of ['arm', 'upgrades', 'pearls'] as const) if (!Object.hasOwn(out, key)) out[key] = parsed[key];
  return out;
};

// Accepts only what `buildRunExport` writes: the exact envelope keys, a real ISO time, and records that
// survive `parseRun` unchanged. Anything else is null - unlike the save's tolerant reader, one bad record
// rejects the whole paste, since a developer reading it wants to know the log was damaged.
export const parseRunExport = (raw: string): RunExport | null => {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const doc = data as Record<string, unknown>;
  if (Object.keys(doc).sort().join() !== 'exported,format,runs,version') return null;
  if (doc.format !== RUN_EXPORT_FORMAT || doc.version !== RUN_EXPORT_VERSION) return null;
  if (typeof doc.exported !== 'string' || Number.isNaN(Date.parse(doc.exported)) || new Date(doc.exported).toISOString() !== doc.exported) return null;
  if (!Array.isArray(doc.runs)) return null;
  const runs: RunEnd[] = [];
  for (const record of doc.runs) {
    const end = parseRun(record);
    if (!end || JSON.stringify(end) !== JSON.stringify(withDefaults(record, end))) return null;
    runs.push(end);
  }
  return { format: RUN_EXPORT_FORMAT, version: RUN_EXPORT_VERSION, exported: doc.exported, runs };
};
