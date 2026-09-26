import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { devOnlyHooks, findLeaks } from '../scripts/build/leaks.ts';

const source = readFileSync(new URL('../app/dungeon-game.tsx', import.meta.url), 'utf8');

test('the development-only hooks are read off the game source, and the fixture is among them', () => {
  const hooks = devOnlyHooks(source);
  assert.ok(hooks.includes('configureCombatFixture'));
  assert.ok(hooks.includes('drainGpu'));
  assert.ok(!hooks.includes('teleport'), 'teleport is a public hook, assigned in the object literal');
});

test('a bundle carrying a development-only hook or the eager-boot switch is reported', () => {
  const clean = 'window.render_game_to_text=a;window.advanceTime=b;window.dungeonTest=c;';
  assert.deepEqual(findLeaks(clean, ['drainGpu']), { leaked: [], missingPublic: [] });
  // The eager switch as the minifier actually wrote it when the guard was removed (checked by hand).
  assert.deepEqual(findLeaks(clean + 'x.drainGpu=1;new URLSearchParams(location.search).get(`boot`)===`eager`&&zi()', ['drainGpu']).leaked, ['drainGpu', '?boot=eager']);
  assert.deepEqual(findLeaks('unrelated chunk', []).missingPublic, ['render_game_to_text', 'advanceTime', 'dungeonTest']);
});
