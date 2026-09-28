// Fails when a development-only hook or the `?boot=eager` switch reaches the built client, or when the
// scan read nothing that looks like the game (so a moved output folder cannot pass it by accident).
//   npm run build && npm run build:check
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { devOnlyHooks, findLeaks } from './leaks.ts';

const root = new URL('../../', import.meta.url).pathname;
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : path.endsWith('.js') ? [path] : [];
});
const files = walk(join(root, 'dist/client'));
const devOnly = devOnlyHooks(readFileSync(join(root, 'app/dungeon-game.tsx'), 'utf8'));
if (devOnly.length < 5) throw new Error(`found only ${devOnly.length} development-only hooks in dungeon-game.tsx; the pattern no longer matches the source`);
const report = findLeaks(files.map((file) => readFileSync(file, 'utf8')).join('\n'), devOnly);
if (report.missingPublic.length) throw new Error(`the built client has no ${report.missingPublic.join(', ')} - this scanned the wrong files (${files.length} read)`);
if (report.leaked.length) throw new Error(`development-only code reached the production bundle: ${report.leaked.join(', ')}`);
console.log(`${files.length} files, ${devOnly.length} development-only hooks, none shipped`);
