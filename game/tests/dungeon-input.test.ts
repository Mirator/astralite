import assert from 'node:assert/strict';
import test from 'node:test';
import { SCREEN_DOWN, SCREEN_RIGHT } from '../app/dungeon-aim.ts';
import {
  bindLabel, isHeld, keycapLabel, keyLabel, moveHeading, PAD_DEADZONE, padAxis, padLook, parseCommand,
  pointerNdc, readKey, screenHeading,
} from '../app/dungeon-input.ts';
import { DEFAULT_BINDS, type Action } from '../app/dungeon-save.ts';

const binds = () => JSON.parse(JSON.stringify(DEFAULT_BINDS)) as typeof DEFAULT_BINDS;

test('key legends shorten a code only where its tail is already the character', () => {
  assert.equal(keyLabel('KeyW'), 'W');
  assert.equal(keyLabel('Digit3'), '3');
  assert.equal(keyLabel('ArrowUp'), '↑');
  assert.equal(keyLabel('ShiftLeft'), 'Shift');
  assert.equal(keyLabel('Space'), 'Space');
  assert.equal(bindLabel(['ShiftLeft', 'ShiftRight']), 'Shift', 'two codes, one legend, said once');
  assert.equal(keycapLabel(['Space']), 'SPC');
  assert.equal(keycapLabel(['KeyE']), 'E');
  assert.equal(keycapLabel(['Backspace']), 'BAC');
});

test('an action is held by its bound keys or by any device slot of its own', () => {
  const b = binds();
  assert.equal(isHeld(new Set(['Space']), b, 'attack'), true);
  assert.equal(isHeld(new Set(['Touchattack']), b, 'attack'), true);
  assert.equal(isHeld(new Set(['Mouseattack']), b, 'attack'), true);
  assert.equal(isHeld(new Set(['Padattack']), b, 'attack'), true);
  assert.equal(isHeld(new Set(['KeyE']), b, 'attack'), false);
  b.attack = ['KeyJ'];
  assert.equal(isHeld(new Set(['Space']), b, 'attack'), false, 'a rebind is read live');
});

test('a screen push becomes a unit floor heading on the camera basis, exactly', () => {
  const right = screenHeading(1, 0);
  assert.ok(Math.abs(right.x - SCREEN_RIGHT.x) < 1e-12 && Math.abs(right.z - SCREEN_RIGHT.z) < 1e-12);
  const down = screenHeading(0, 1);
  assert.ok(Math.abs(down.x - SCREEN_DOWN.x) < 1e-12 && Math.abs(down.z - SCREEN_DOWN.z) < 1e-12);
  const diagonal = screenHeading(1, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-12);
  assert.deepEqual(screenHeading(0, 0), { x: 0, z: 0 });
});

test('a planted stick outranks the keys, and lifting it hands them back', () => {
  const held = (action: Action) => action === 'up';
  const keys = moveHeading(held, null);
  assert.deepEqual(keys, screenHeading(0, -1));
  assert.deepEqual(moveHeading(held, { x: 1, z: 0 }), screenHeading(1, 0));
  assert.deepEqual(moveHeading(() => false, null), { x: 0, z: 0 });
});

test('a keydown is decoded against the bindings and whether the run is live', () => {
  const b = binds();
  assert.deepEqual(readKey('Space', false, b, true), { prevent: true, command: null, hold: true, claimAim: true, press: ['attack'] });
  assert.deepEqual(readKey('Space', true, b, true), { prevent: true, command: null, hold: true, claimAim: false, press: [] }, 'a repeat only holds');
  assert.deepEqual(readKey('Space', false, b, false), { prevent: false, command: null, hold: false, claimAim: false, press: [] }, 'a held world ignores play keys');
  assert.equal(readKey('KeyW', false, b, true).claimAim, false, 'walking does not claim the aim');
  assert.equal(readKey('KeyW', false, b, true).prevent, false, 'a key the browser does not act on is left alone');
  assert.equal(readKey('Escape', false, b, false).command, 'pause');
  assert.equal(readKey('Escape', true, b, true).command, null, 'a held Escape does not flicker the menu');
  assert.equal(readKey('KeyM', false, b, false).command, 'mute');
  assert.equal(readKey('KeyF', false, b, true).command, 'fullscreen');
  assert.deepEqual(readKey('KeyE', false, b, true).press, ['swap']);
  // Freeing an arrow by rebinding hands scrolling back to the page.
  b.up = ['KeyI'];
  assert.equal(readKey('ArrowUp', false, b, true).prevent, false);
});

test('every dungeon-action detail parses to the command the game answers', () => {
  assert.deepEqual(parseCommand('continue'), { kind: 'continue' });
  assert.deepEqual(parseCommand('restart'), { kind: 'restart', seed: undefined });
  assert.deepEqual(parseCommand('restart:42'), { kind: 'restart', seed: 42 });
  assert.deepEqual(parseCommand('restart:-1'), { kind: 'restart', seed: 4294967295 }, 'seeds are unsigned');
  assert.deepEqual(parseCommand('restart:junk'), { kind: 'restart', seed: undefined });
  assert.deepEqual(parseCommand('start:7'), { kind: 'start', seed: 7 });
  assert.deepEqual(parseCommand('boon:edge'), { kind: 'boon', id: 'edge' });
  assert.deepEqual(parseCommand('stick:0.5,-1'), { kind: 'stick', stick: { x: 0.5, z: -1 } });
  assert.deepEqual(parseCommand('stick:junk'), { kind: 'stick', stick: null }, 'junk is a release');
  assert.deepEqual(parseCommand('move:up'), { kind: 'move', action: 'up' });
  assert.deepEqual(parseCommand('stop:up'), { kind: 'stop', action: 'up' });
  for (const kind of ['map', 'pause', 'mute', 'fullscreen', 'attack', 'hold-attack', 'release-attack', 'dash', 'swap'] as const) {
    assert.deepEqual(parseCommand(kind), { kind });
  }
  assert.equal(parseCommand('restarting'), null);
  assert.equal(parseCommand('startle'), null);
  assert.equal(parseCommand(''), null);
});

test('the cursor maps into NDC over the canvas box, and a box with no area has none', () => {
  const box = { left: 100, top: 50, width: 200, height: 100 };
  assert.deepEqual(pointerNdc(200, 100, box), { x: 0, y: 0 });
  assert.deepEqual(pointerNdc(100, 50, box), { x: -1, y: 1 });
  assert.deepEqual(pointerNdc(300, 150, box), { x: 1, y: -1 });
  assert.equal(pointerNdc(1, 1, { ...box, width: 0 }), null);
});

test('a pad stick is dead inside its zone and rescaled from the zone edge', () => {
  assert.equal(padAxis([0.2, 0], 0, 1), null);
  const edge = padAxis([PAD_DEADZONE + 1e-9, 0], 0, 1)!;
  assert.ok(edge.x < 1e-6, 'the first usable degree of travel is nearly nothing');
  const full = padAxis([1, 0], 0, 1)!;
  assert.ok(Math.abs(full.x - 1) < 1e-12);
  assert.equal(padAxis([], 0, 1), null, 'missing axes read as rest');
  assert.equal(padLook([0, 0, 0, 0]), null);
  const look = padLook([0, 0, 0, 1])!;
  assert.deepEqual(look, screenHeading(0, 1));
});
