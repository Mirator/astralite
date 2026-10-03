import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { devOnlyHooks, findLeaks, gameRootFrom } from '../scripts/build/leaks.ts';

const source = readFileSync(new URL('../app/dungeon-game.tsx', import.meta.url), 'utf8');

test('the development-only hooks are read off the game source, and the fixture is among them', () => {
  const hooks = devOnlyHooks(source);
  assert.ok(hooks.includes('configureCombatFixture'));
  assert.ok(hooks.includes('drainGpu'));
  assert.ok(hooks.includes('buildArena'));
  assert.ok(!hooks.includes('teleport'), 'teleport is a public hook, assigned in the object literal');
});

test('a bundle carrying a development-only hook or the eager-boot switch is reported', () => {
  const clean = 'window.render_game_to_text=a;window.advanceTime=b;window.dungeonTest=c;';
  assert.deepEqual(findLeaks(clean, ['drainGpu']), { leaked: [], missingPublic: [] });
  // The eager switch as the minifier actually wrote it when the guard was removed (checked by hand).
  assert.deepEqual(findLeaks(clean + 'x.drainGpu=1;new URLSearchParams(location.search).get(`boot`)===`eager`&&zi()', ['drainGpu']).leaked, ['drainGpu', '?boot=eager']);
  // Plan 020: the harness's hall switch, read the same minified way, is development-only too.
  assert.deepEqual(findLeaks(clean + 'new URLSearchParams(location.search).get(`hall`)===`skip`&&zi()', []).leaked, ['?hall=skip']);
  assert.deepEqual(findLeaks(clean + 'x.get("hall")', []).leaked, ['?hall=skip']);
  assert.deepEqual(findLeaks(clean + 'a.get(`halls`)', []).leaked, [], 'only the hall switch itself is matched');
  // Plan 021 (D14): the dev boss link is development-only as well, and only the link itself is matched.
  assert.deepEqual(findLeaks(clean + 'new URLSearchParams(location.search).get(`boss`)', []).leaked, ['?boss=']);
  assert.deepEqual(findLeaks(clean + 'x.get("boss")', []).leaked, ['?boss=']);
  assert.deepEqual(findLeaks(clean + 'a.get(`bosses`)', []).leaked, [], 'only the boss link itself is matched');
  // Plan 022 (D14): the dev waves link, the same way.
  assert.deepEqual(findLeaks(clean + 'new URLSearchParams(location.search).get(`waves`)===`off`', []).leaked, ['?waves=']);
  assert.deepEqual(findLeaks(clean + 'x.get("waves")', []).leaked, ['?waves=']);
  assert.deepEqual(findLeaks(clean + 'a.get(`wavelength`)', []).leaked, [], 'only the waves link itself is matched');
  assert.deepEqual(findLeaks('unrelated chunk', []).missingPublic, ['render_game_to_text', 'advanceTime', 'dungeonTest']);
  // The arena ships no hook name of its own on the page it lives on; its event and its menu label are what give it away.
  assert.deepEqual(findLeaks(clean + 'dispatchEvent(new CustomEvent(`dungeon-arena`,{detail:a}))', []).leaked, ['dungeon-arena']);
  assert.deepEqual(findLeaks(clean + '"Arena · dev"', []).leaked, ['Arena · dev']);
});

test('build:check finds the game folder from a checkout path with a space in it', () => {
  // `new URL('../../', import.meta.url).pathname` gave `/C:/Users/Miroslav%20Pavelek/...` on Windows, and the scan
  // failed with ENOENT on `C:\C:\Users\Miroslav%20Pavelek\...\dist\client`; the `%20` breaks it on every platform.
  const checkout = mkdtempSync(join(tmpdir(), 'with space '));
  try {
    const game = join(checkout, 'game');
    mkdirSync(join(game, 'scripts', 'build'), { recursive: true });
    const script = pathToFileURL(join(game, 'scripts', 'build', 'check.ts'));
    assert.match(script.href, /%20/, 'the fixture URL has to carry an encoded space to test anything');
    const root = gameRootFrom(script.href);
    assert.equal(root, game + sep, `resolved ${root} from ${script.href}`);
    assert.ok(existsSync(join(root, 'scripts', 'build')), `${root} is not a folder this platform can open`);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});
