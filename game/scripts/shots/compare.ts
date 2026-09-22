// Before/after contact sheet for an art change: every scene in tests/browser/shots.spec.ts, captured on the
// previous version and on the working tree, with an amplified difference beside them and the art-direction
// concept pinned above. It judges nothing; a human looks at the sheet.
//
//   npm run shots:compare                          fork point with main vs the working tree, d3d11
//   npm run shots:compare -- --base HEAD           HEAD vs the working tree (proves the captures replay)
//   npm run shots:compare -- --before ../output/shots/baseline --gl swiftshader
//   npm run shots:compare -- --help
//
// "Previous" is captured from a temporary `git worktree` of the base commit that borrows this checkout's
// node_modules through a junction, on its own port (vite.config.ts keys the prebundle cache on the port, so
// the two never share one). The two captures run one after the other, never side by side - each is a whole
// dev server plus a WebGL context - and the worktree is removed afterwards, including after a failure or ^C.
// Both sides always use the same renderer, because a d3d11 frame and a SwiftShader frame differ everywhere.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { diffPixels, type DiffStats } from './diff.ts';
import {
  defaultBase,
  formatSummary,
  type Gl,
  pairCaptures,
  parseArgs,
  parseCosts,
  renderSheet,
  type Row,
  type Side,
  USAGE,
} from './lib.ts';

const GAME = fileURLToPath(new URL('../../', import.meta.url));
const REPO = resolve(GAME, '..');
const MODULES = join(GAME, 'node_modules');
const SPEC = 'tests/browser/shots.spec.ts';
const BASELINE = resolve(REPO, 'output/shots/baseline');
const REFERENCE = resolve(REPO, 'docs/reference/dungeons-beyond-concept.png');
/** The concept sheet's main isometric scene; the rest of the sheet is callouts. */
const REFERENCE_REGION: [number, number, number, number] = [0, 0, 960, 515];
const WORKTREE_PREFIX = 'astralite-shots-';

const started = new Date();
let options: ReturnType<typeof parseArgs>;
try {
  options = parseArgs(process.argv.slice(2), process.env);
} catch (error) {
  console.error(`\n  ${(error as Error).message}\n${USAGE}`);
  process.exit(2);
}
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

const git = (args: string[], cwd = REPO) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
};
const tryGit = (args: string[]) => {
  try { return git(args); } catch { return null; }
};
const fail = (message: string): never => {
  console.error(`\n  ${message}\n`);
  process.exit(2);
};
const warnings: string[] = [];
const warn = (message: string) => {
  warnings.push(message);
  console.warn(`\n  !!! ${message}\n`);
};

/** Something answering on the port, or something holding it: either way the suite would refuse to start. */
const portBusy = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); done(true); });
    socket.once('error', () => {
      const server = createServer();
      server.once('error', () => done(true));
      server.listen(port, '127.0.0.1', () => server.close(() => done(false)));
    });
  });
const waitForPortFree = async (port: number, ms = 15_000) => {
  for (const until = Date.now() + ms; Date.now() < until;) {
    if (!(await portBusy(port))) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

/** What a directory of PNGs was captured on, if it says. The reviewed baseline is known to be SwiftShader. */
const glOf = (dir: string): Gl | null => {
  if (resolve(dir) === BASELINE) return 'swiftshader';
  try { return JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).gl ?? null; } catch { return null; }
};
/** An earlier comparison's side keeps saying what it was captured from when it is re-sheeted. */
const metaOf = (dir: string): Partial<Side> => {
  try {
    const { source, sha, dirty, seconds, exitCode } = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    return { source, sha, dirty, seconds, exitCode };
  } catch { return {}; }
};
const costsOf = (dir: string) => {
  try { return JSON.parse(readFileSync(join(dir, 'costs.json'), 'utf8')); } catch { return {}; }
};
const pngs = (dir: string) => readdirSync(dir).filter((file) => /\.png$/i.test(file));

// ---------------------------------------------------------------------------------------------- the plan

const stamp = started.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const OUT = resolve(GAME, options.out ?? join('outputs', 'shots-compare', stamp));
const beforeDir = options.before === undefined ? null : resolve(GAME, options.before);
const afterDir = options.after === undefined ? null : resolve(GAME, options.after);
for (const dir of [beforeDir, afterDir]) if (dir && !existsSync(dir)) fail(`${dir} does not exist`);

const head = git(['rev-parse', 'HEAD']);
const dirty = git(['status', '--porcelain']) !== '';
let baseSha: string | null = null;
let baseWhy = '';
if (!beforeDir) {
  if (options.base !== undefined) {
    baseSha = tryGit(['rev-parse', '--verify', '--quiet', `${options.base}^{commit}`]) ?? fail(`--base ${options.base} is not a commit`);
    baseWhy = options.base;
  } else {
    const picked = (() => {
      try {
        return defaultBase({
          head,
          forkPoint: tryGit(['merge-base', 'main', 'HEAD']),
          headParent: tryGit(['rev-parse', '--verify', '--quiet', 'HEAD~1^{commit}']),
          dirty,
        });
      } catch (error) { return fail((error as Error).message); }
    })();
    baseSha = picked.sha;
    baseWhy = picked.why;
  }
  // A base older than the hooks this relies on would capture nothing, or capture on the wrong renderer and say
  // nothing about it - which is the one mistake this tool exists to make impossible.
  const config = tryGit(['show', `${baseSha}:game/playwright.config.ts`]) ?? '';
  const helpers = tryGit(['show', `${baseSha}:game/tests/browser/helpers.ts`]) ?? '';
  if (tryGit(['cat-file', '-e', `${baseSha}:game/${SPEC}`]) === null) fail(`${baseWhy} has no game/${SPEC}`);
  if (!config.includes('GAME_TEST_PORT')) fail(`${baseWhy} predates GAME_TEST_PORT, so it cannot run beside this checkout`);
  if (!config.includes('GAME_TEST_GL')) fail(`${baseWhy} predates GAME_TEST_GL: it would capture on SwiftShader whatever --gl says`);
  if (!helpers.includes('GAME_TEST_CAPTURE')) fail(`${baseWhy} predates GAME_TEST_CAPTURE`);
  if (tryGit(['diff', '--quiet', baseSha, '--', 'game/package-lock.json']) === null) {
    warn(`game/package-lock.json differs between ${baseWhy} and the working tree. The base runs on this checkout's node_modules, so a dependency change shows up on neither side of the sheet.`);
  }
}

const sideGl = (dir: string | null) => (dir ? glOf(dir) : options.gl);
const glBefore = sideGl(beforeDir), glAfter = sideGl(afterDir);
if (glBefore !== glAfter) {
  const message = glBefore && glAfter
    ? `the previous side is ${glBefore} and the current side is ${glAfter}: every pixel will differ for reasons that are not the change.`
    : `the renderer of ${glBefore ? afterDir : beforeDir} is unknown (no meta.json), so the sheet may be comparing ${glBefore ?? glAfter} with something else.`;
  if (glBefore && glAfter && !options.allowMixedGl) fail(`refusing: ${message}\n  Pass --gl ${beforeDir ? glBefore : glAfter} to match it, or --allow-mixed-gl to compare anyway.`);
  warn(message);
}

for (const port of [...(beforeDir ? [] : [options.basePort]), ...(afterDir ? [] : [options.port])]) {
  if (await portBusy(port)) fail(`something is already listening on 127.0.0.1:${port}. The browser suite will not adopt it; stop it, or move this run with --port / --base-port.`);
}
mkdirSync(OUT, { recursive: true });
console.log(`\n  shot comparison -> ${OUT}`);
if (baseSha) console.log(`  previous: ${baseWhy} (${baseSha.slice(0, 12)}) on ${options.gl}, port ${options.basePort}`);
else console.log(`  previous: ${beforeDir}`);
console.log(afterDir ? `  current:  ${afterDir}` : `  current:  working tree at ${head.slice(0, 12)}${dirty ? ' + uncommitted changes' : ''} on ${options.gl}, port ${options.port}`);

// --------------------------------------------------------------------------------------- the captures

let child: ChildProcess | null = null;
let interrupted = false;
const cleanups: (() => void)[] = [];
const cleanUp = () => { while (cleanups.length) cleanups.pop()!(); };
process.on('SIGINT', () => { interrupted = true; child?.kill(); });
process.on('SIGTERM', () => { interrupted = true; child?.kill(); });
// Last resort for an exit nothing awaited: the worktree must not outlive the run.
process.on('exit', cleanUp);

/** Runs shots.spec.ts once, capturing, and copies what it drew into `dest` flat. */
const capture = async (label: string, cwd: string, port: number, dest: string) => {
  const raw = join(OUT, 'raw', label);
  mkdirSync(dest, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GAME_TEST_CAPTURE: '1',
    GAME_TEST_PORT: String(port),
    GAME_TEST_WORKERS: '1',
  };
  if (options.gl === 'd3d11') env.GAME_TEST_GL = 'd3d11';
  else delete env.GAME_TEST_GL;
  const args = [
    join(cwd, 'node_modules', '@playwright', 'test', 'cli.js'),
    'test', SPEC, '--reporter=list', '--workers=1', `--output=${raw}`,
    ...(options.grep ? ['--grep', options.grep] : []),
  ];
  const log = createWriteStream(join(dest, 'run.log'));
  let stdout = '';
  const t0 = performance.now();
  console.log(`\n  [${label}] capturing ${SPEC} in ${cwd}`);
  const code = await new Promise<number | null>((done) => {
    const proc = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child = proc;
    const relay = (chunk: Buffer, to: NodeJS.WriteStream) => {
      const text = chunk.toString();
      stdout += text;
      log.write(text);
      to.write(text.replace(/^(?=.)/gm, `  [${label}] `));
    };
    proc.stdout.on('data', (chunk: Buffer) => relay(chunk, process.stdout));
    proc.stderr.on('data', (chunk: Buffer) => relay(chunk, process.stderr));
    proc.on('error', (error) => { stdout += String(error); done(null); });
    proc.on('close', (status) => done(status));
  });
  child = null;
  log.end();
  const seconds = (performance.now() - t0) / 1000;
  // Playwright attaches each capture a second time under `attachments/`; the file the test wrote is the one
  // beside it. A failed test also leaves `test-failed-N.png`, which is not a scene.
  const found = new Map<string, string>();
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'attachments' && !entry.name.startsWith('.')) walk(path); continue; }
      if (!/\.png$/i.test(entry.name) || /^test-failed-\d+\.png$/.test(entry.name)) continue;
      if (found.has(entry.name)) throw new Error(`two captures are both called ${entry.name}: ${found.get(entry.name)} and ${path}`);
      found.set(entry.name, path);
    }
  };
  walk(raw);
  for (const [name, path] of found) copyFileSync(path, join(dest, name));
  const costs = parseCosts(stdout);
  writeFileSync(join(dest, 'costs.json'), JSON.stringify(costs, null, 1));
  if (!(await waitForPortFree(port))) warn(`the ${label} dev server is still holding 127.0.0.1:${port} after the run; stop it by hand.`);
  console.log(`  [${label}] ${found.size} captures in ${seconds.toFixed(0)}s, exit ${code}`);
  if (code !== 0) warn(`the ${label} capture exited ${code}${interrupted ? ' (interrupted)' : ''}; its column is whatever it drew before that. See ${relative(OUT, join(dest, 'run.log'))}.`);
  return { seconds, code, costs, count: found.size };
};

/** Removes the junction first, and only then the worktree, so nothing recursive can ever walk into node_modules. */
const removeWorktree = (path: string) => {
  const link = join(path, 'game', 'node_modules');
  try {
    if (lstatSync(link).isSymbolicLink()) {
      try { unlinkSync(link); } catch { rmdirSync(link); }
    }
  } catch { /* never made, or already gone */ }
  if (existsSync(link)) {
    console.error(`\n  !!! could not unlink ${link}; leaving ${path} in place rather than risk deleting through it.\n  Remove the junction by hand (rmdir, not rm -r), then: git worktree remove --force "${path}"\n`);
    return;
  }
  if (!existsSync(join(MODULES, '@playwright', 'test', 'cli.js'))) console.error(`\n  !!! ${MODULES} looks damaged after unlinking the junction.\n`);
  const removed = spawnSync('git', ['worktree', 'remove', '--force', path], { cwd: REPO, encoding: 'utf8' });
  if (removed.status !== 0 && existsSync(path)) {
    // Usually a process still closing a file on Windows. The junction is gone, so a plain delete is safe.
    try { rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch (error) {
      console.error(`\n  !!! could not remove ${path}: ${(error as Error).message}\n`);
    }
  }
  spawnSync('git', ['worktree', 'prune'], { cwd: REPO });
};

const sides: { before: Side; after: Side } = {
  before: beforeDir
    ? { label: 'previous', source: relative(REPO, beforeDir) || beforeDir, ...metaOf(beforeDir), gl: glBefore, costs: costsOf(beforeDir) }
    : { label: 'previous', source: baseWhy, sha: baseSha!, gl: options.gl, costs: {} },
  after: afterDir
    ? { label: 'current', source: relative(REPO, afterDir) || afterDir, ...metaOf(afterDir), gl: glAfter, costs: costsOf(afterDir) }
    : { label: 'current', source: 'working tree', sha: head, dirty, gl: options.gl, costs: {} },
};
const beforeOut = join(OUT, 'before'), afterOut = join(OUT, 'after');
let failed = false;

try {
  spawnSync('git', ['worktree', 'prune'], { cwd: REPO });
  const stale = git(['worktree', 'list', '--porcelain']).split(/\r?\n/)
    .filter((line) => line.startsWith('worktree ') && line.includes(WORKTREE_PREFIX)).map((line) => line.slice(9));
  if (stale.length) warn(`an earlier comparison left worktrees behind: ${stale.join(', ')}. Unlink each one's game/node_modules junction, then git worktree remove --force it.`);

  if (baseSha) {
    // The long form of the temp path: Windows hands out an 8.3 short name, and vite compares realpaths.
    const path = join(realpathSync.native(tmpdir()), `${WORKTREE_PREFIX}${stamp}`);
    cleanups.push(() => removeWorktree(path));
    git(['worktree', 'add', '--detach', path, baseSha]);
    symlinkSync(MODULES, join(path, 'game', 'node_modules'), 'junction');
    const run = await capture('before', join(path, 'game'), options.basePort, beforeOut);
    Object.assign(sides.before, { seconds: run.seconds, exitCode: run.code, costs: run.costs });
    failed ||= run.code !== 0 || !run.count;
    cleanUp();
    // Nothing to compare against, so the working tree's capture would be minutes spent on half a sheet.
    if (!run.count) fail(`the base capture drew nothing (exit ${run.code}); see ${join(beforeOut, 'run.log')}`);
  } else {
    mkdirSync(beforeOut, { recursive: true });
    for (const file of pngs(beforeDir!)) copyFileSync(join(beforeDir!, file), join(beforeOut, file));
  }
  writeFileSync(join(beforeOut, 'meta.json'), JSON.stringify({ ...sides.before, costs: undefined }, null, 1));
  if (interrupted) fail('interrupted');

  if (!afterDir) {
    const run = await capture('after', GAME, options.port, afterOut);
    Object.assign(sides.after, { seconds: run.seconds, exitCode: run.code, costs: run.costs });
    failed ||= run.code !== 0 || !run.count;
  } else {
    mkdirSync(afterOut, { recursive: true });
    for (const file of pngs(afterDir)) copyFileSync(join(afterDir, file), join(afterOut, file));
  }
  writeFileSync(join(afterOut, 'meta.json'), JSON.stringify({ ...sides.after, costs: undefined }, null, 1));
  if (interrupted) fail('interrupted');
} finally {
  cleanUp();
}

// ------------------------------------------------------------------------------------------ the sheet

const pairs = pairCaptures(pngs(beforeOut), pngs(afterOut));
const diffOut = join(OUT, 'diff');
mkdirSync(diffOut, { recursive: true });
const dataUrl = (path: string) => `data:image/png;base64,${readFileSync(path).toString('base64')}`;
const rows: Row[] = [];
let reference: { crop: string; full: string; region: [number, number, number, number] } | null = null;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  for (const pair of pairs) {
    const row: Row = {
      ...pair,
      beforeSrc: pair.before ? `before/${pair.name}.png` : null,
      afterSrc: pair.after ? `after/${pair.name}.png` : null,
      diffSrc: null,
      stats: null,
    };
    if (!pair.before || !pair.after) {
      row.note = pair.before ? 'only in the previous version' : 'only in the current version';
      rows.push(row);
      continue;
    }
    const result = await page.evaluate(
      async ([a, b, source, gain]) => {
        // The shared diff arrives as source text; see diff.ts for why.
        const diff = (0, eval)(`(${source})`);
        const grab = async (src: string) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(image, 0, 0);
          return ctx.getImageData(0, 0, image.width, image.height);
        };
        const one = await grab(a as string), two = await grab(b as string);
        if (one.width !== two.width || one.height !== two.height) {
          return { size: `sizes differ: ${one.width}x${one.height} before, ${two.width}x${two.height} after` };
        }
        const out = new ImageData(one.width, one.height);
        const stats = diff(one.data, two.data, one.width, gain, out.data);
        const canvas = document.createElement('canvas');
        canvas.width = one.width;
        canvas.height = one.height;
        const ctx = canvas.getContext('2d')!;
        ctx.putImageData(out, 0, 0);
        // A few changed pixels are invisible at any gain on a 1000px frame, so the box says where to look. It
        // is drawn on the picture only; the numbers above came from the frames.
        if (stats.box) {
          const [x0, y0, x1, y1] = stats.box;
          ctx.strokeStyle = '#ff3df2';
          ctx.lineWidth = 1;
          ctx.strokeRect(x0 - 3.5, y0 - 3.5, x1 - x0 + 8, y1 - y0 + 8);
        }
        return { stats, png: canvas.toDataURL('image/png') };
      },
      [dataUrl(join(beforeOut, `${pair.name}.png`)), dataUrl(join(afterOut, `${pair.name}.png`)), diffPixels.toString(), options.gain] as const,
    );
    if ('size' in result) {
      row.note = result.size;
    } else {
      row.stats = result.stats as DiffStats;
      row.diffSrc = `diff/${pair.name}.png`;
      writeFileSync(join(OUT, row.diffSrc), Buffer.from(result.png!.split(',')[1], 'base64'));
    }
    rows.push(row);
  }

  if (existsSync(REFERENCE)) {
    copyFileSync(REFERENCE, join(OUT, 'reference.png'));
    const crop = await page.evaluate(async ([src, [x, y, w, h]]) => {
      const image = new Image();
      image.src = src as string;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(w, image.width - x);
      canvas.height = Math.min(h, image.height - y);
      canvas.getContext('2d')!.drawImage(image, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      return { png: canvas.toDataURL('image/png'), size: [image.width, image.height] };
    }, [dataUrl(REFERENCE), REFERENCE_REGION] as const);
    if (crop.size[0] !== 1536 || crop.size[1] !== 1024) warn(`the concept sheet is ${crop.size.join('x')}, not 1536x1024; the crop ${REFERENCE_REGION.join(',')} may no longer frame its main scene.`);
    writeFileSync(join(OUT, 'reference-crop.png'), Buffer.from(crop.png.split(',')[1], 'base64'));
    reference = { crop: 'reference-crop.png', full: 'reference.png', region: REFERENCE_REGION };
  } else {
    warn(`no art-direction reference at ${relative(REPO, REFERENCE)}`);
  }
} finally {
  await browser.close();
}

const sheet = {
  created: started.toISOString(),
  command: `npm run shots:compare -- ${process.argv.slice(2).join(' ')}`.trim().replace(/ --$/, ''),
  gain: options.gain,
  before: sides.before,
  after: sides.after,
  rows,
  reference,
  warnings,
};
writeFileSync(join(OUT, 'index.html'), renderSheet(sheet));
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(sheet, null, 1));
// Playwright's own output is a second copy of every PNG; it is only worth keeping for a failure's trace.
if (!failed) rmSync(join(OUT, 'raw'), { recursive: true, force: true });

console.log(`\n${formatSummary(sheet)}\n`);
for (const side of [sides.before, sides.after]) {
  if (side.seconds !== undefined) console.log(`  ${side.label} captured in ${side.seconds.toFixed(0)}s`);
}
if (warnings.length) console.log(`\n  ${warnings.length} warning${warnings.length > 1 ? 's' : ''} above, repeated on the sheet.`);
console.log(`\n  sheet: ${join(OUT, 'index.html')}\n`);
process.exit(failed ? 1 : 0);
