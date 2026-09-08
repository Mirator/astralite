// GitHub Pages serves this project from a repository sub-path
// (https://<user>.github.io/<repo>/), but the vinext export writes root-absolute
// `/_next/...` asset URLs. vinext's `basePath` does not survive
// `output: 'export'` (it emits assets but no HTML) and Vite's relative `base`
// leaves the font URLs absolute, so rewrite the emitted output instead. Every
// route is the index page, so document-relative URLs always resolve inside the
// sub-path.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const clientDir = process.argv[2] ?? 'dist/client';

async function rewrite(file, apply) {
  const original = await readFile(file, 'utf8');
  const rewritten = apply(original);
  if (rewritten !== original) await writeFile(file, rewritten);
  return rewritten !== original;
}

const entries = await readdir(clientDir, { withFileTypes: true });
const htmlFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
  .map((entry) => join(clientDir, entry.name));

if (htmlFiles.length === 0) {
  throw new Error(`No HTML files in ${clientDir}; did the build run?`);
}

for (const file of htmlFiles) {
  await rewrite(file, (source) => source.replaceAll('/_next/', './_next/'));
  const left = (await readFile(file, 'utf8')).match(/(?<!\.)\/_next\//g)?.length ?? 0;
  if (left > 0) throw new Error(`${file} still has ${left} root-absolute asset URLs`);
  console.log(`rewrote ${file}`);
}

// Vite's module-preload helper prefixes lazily loaded chunks with the build
// base (`/`). The dynamic `import()` itself is already relative, so without
// this the page works but fires a handful of 404 preloads.
const chunkDir = join(clientDir, '_next/static/chunks');
const assetsUrlPattern = /return`\/`\+([a-zA-Z_$][\w$]*)\}/;
let patched = 0;
for (const name of await readdir(chunkDir)) {
  if (!name.endsWith('.js')) continue;
  if (await rewrite(join(chunkDir, name), (source) =>
    source.replace(assetsUrlPattern, 'return`./`+$1}'))) {
    patched += 1;
    console.log(`patched preload base in ${name}`);
  }
}
if (patched !== 1) {
  throw new Error(
    `Expected exactly one Vite preload-base helper, patched ${patched}. ` +
      'The bundler output changed; update scripts/pages-relative-paths.mjs.',
  );
}
