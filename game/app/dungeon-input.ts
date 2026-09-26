// Input, read into intent. Keys, the touch protocol, a pad and the cursor all used to be decoded inline in
// the world closure in dungeon-game.tsx, beside the code that acted on them. What a key, a button or a
// `dungeon-action` event *means* is decided here instead, with no three.js, React or DOM: the game still
// owns the listeners, the held-key set and every consequence, and asks this file what each one said.

import { SCREEN_DOWN, SCREEN_RIGHT } from './dungeon-aim.ts';
import { ACTIONS, RESERVED, type Action, type Binds } from './dungeon-save.ts';

export type Stick = { x: number; z: number };

// Keys the browser acts on itself — scrolling, quick-find, back-navigation. Only ever swallowed while one
// of them is actually bound to something, so the list follows a rebind instead of being frozen at the
// defaults: an arrow freed by a rebind goes back to scrolling the page, and a newly bound PageDown stops.
// Tab is deliberately absent. Trapping it would cost a keyboard-only player the way out of the canvas.
export const SCROLL_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Backspace', 'Slash', 'Quote']);
export const ACTION_LABELS: Record<Action, string> = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', attack: 'Strike', dash: 'Dodge', swap: 'Take arm', pause: 'Pause', mute: 'Sound', fullscreen: 'Fullscreen' };
// A KeyboardEvent.code is a hardware position, not a legend, and 'KeyW' on the card would be nonsense to
// the AZERTY player this exists for. `key` is the legend but is unstable under modifiers, so the code is
// shortened where its tail is already the character and left whole where it is not.
export const keyLabel = (code: string) => code.startsWith('Key') || code.startsWith('Digit') ? code.replace(/^(Key|Digit)/, '') : code.startsWith('Arrow') ? ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' })[code] ?? code : code.replace(/^(Shift|Control|Alt|Meta)(Left|Right)$/, '$1');
// Deduplicated after labelling, not before: the two shift keys are distinct codes and one legend, and
// "Shift / Shift" tells a player nothing except that the card is not thinking.
export const bindLabel = (codes: string[], join = ' / ') => [...new Set(codes.map(keyLabel))].join(join);
// Plan 014 round 8 (lever 5): the ability row's own keycap reads a full key name ("Space", "Shift")
// at 9px under a 32px diamond - the "unstyled dev placeholder" the critic named. A real keycap is
// engraved with an abbreviation, not the key's full name, so this shortens the same label `bindLabel`
// already produces rather than replacing it - settings and the controls legend keep the full word.
const KEYCAP_GLYPH: Record<string, string> = { Space: 'SPC', Shift: '⇧', Control: '⌃', Alt: '⌥', Enter: '⏎', Escape: 'ESC', Tab: '⇥' };
export const keycapLabel = (codes: string[]) => [...new Set(codes.map(keyLabel))].map((l) => KEYCAP_GLYPH[l] ?? (l.length > 4 ? l.slice(0, 3).toUpperCase() : l.toUpperCase())).join('/');

// Bindings are read at the moment they are asked for, never snapshotted: the card can rebind a key while
// the run is paused behind it. `Touch<action>`, `Mouse<action>` and `Pad<action>` are each a device's own
// slot, belonging to no binding: a held STRIKE must keep swinging whatever the keyboard was rebound to,
// and must not be released by letting go of a key on a different device.
export const isHeld = (keys: ReadonlySet<string>, binds: Binds, action: Action) => binds[action].some(c => keys.has(c))
  || keys.has(`Touch${action}`) || keys.has(`Mouse${action}`) || keys.has(`Pad${action}`);

/**
 * A screen-space push (right, down) turned into a unit heading on the floor, on the camera's own basis.
 * The same arithmetic, in the same order, as the `THREE.Vector3` chain it replaced - scaled right plus
 * scaled down, then normalised through a reciprocal - so a heading comes out bit-for-bit what it was.
 * No push at all is the zero heading.
 */
export const screenHeading = (right: number, down: number): Stick => {
  const x = SCREEN_RIGHT.x * right + SCREEN_DOWN.x * down, z = SCREEN_RIGHT.z * right + SCREEN_DOWN.z * down;
  const scale = 1 / (Math.sqrt(x * x + 0 + z * z) || 1);
  return { x: x * scale, z: z * scale };
};

/**
 * Where the knight is being steered. A planted thumb or a pad's stick outranks the keys for exactly as
 * long as it is there, and lifting it hands steering straight back: neither path can strand the other,
 * because neither ever writes to the other's state.
 */
export const moveHeading = (held: (action: Action) => boolean, steer: Stick | null) => {
  const x = +held('right') - +held('left'), z = +held('down') - +held('up');
  return steer ? screenHeading(steer.x, steer.z) : screenHeading(x, z);
};

/** What one keydown asks for, decided against the bindings and whether the run is live to act on it. */
export type KeyIntent = {
  /** Swallow the browser's own use of the key. */
  prevent: boolean;
  /** A menu-level command that answers whatever state the run is in. */
  command: 'pause' | 'mute' | 'fullscreen' | null;
  /** Record the key as held. */
  hold: boolean;
  /** Striking or dodging from the keyboard is a claim on where the knight points; walking is not. */
  claimAim: boolean;
  /** Gameplay presses, in the order they are answered. */
  press: ('attack' | 'dash' | 'swap')[];
};

/**
 * Decodes a keydown. Escape answers whatever else it is set to: it is the one key no rebind can take
 * away, so a player cannot shut themselves out of the menu that would let them undo the rebind. A key
 * the browser acts on is swallowed only while it is bound to something and the run is live.
 */
export const readKey = (code: string, repeat: boolean, binds: Binds, live: boolean): KeyIntent => {
  const does = (action: Action) => binds[action].includes(code);
  const intent: KeyIntent = { prevent: live && SCROLL_KEYS.has(code) && ACTIONS.some(does), command: null, hold: false, claimAim: false, press: [] };
  if (!repeat && (code === RESERVED || does('pause'))) { intent.command = 'pause'; return intent; }
  if (!repeat && does('mute')) { intent.command = 'mute'; return intent; }
  if (!repeat && does('fullscreen')) { intent.command = 'fullscreen'; return intent; }
  if (!live) return intent;
  intent.hold = true;
  if (repeat) return intent;
  intent.claimAim = does('attack') || does('dash');
  if (does('attack')) intent.press.push('attack');
  if (does('dash')) intent.press.push('dash');
  if (does('swap')) intent.press.push('swap');
  return intent;
};

/** A `dungeon-action` event's detail, parsed. Unknown details parse to null and do nothing. */
export type Command =
  | { kind: 'continue' } | { kind: 'restart'; seed?: number } | { kind: 'start'; seed?: number }
  | { kind: 'map' } | { kind: 'pause' } | { kind: 'mute' } | { kind: 'fullscreen' }
  | { kind: 'boon'; id: string } | { kind: 'stick'; stick: Stick | null }
  | { kind: 'attack' } | { kind: 'hold-attack' } | { kind: 'release-attack' } | { kind: 'dash' } | { kind: 'swap' }
  | { kind: 'move'; action: string } | { kind: 'stop'; action: string };

/** A seed after a `name:` prefix; junk, or nothing at all, means no seed. */
const seedAfter = (detail: string, prefix: number) => { const seed = Number.parseInt(detail.slice(prefix), 10); return Number.isNaN(seed) ? undefined : seed >>> 0; };

/**
 * `restart` opens a fresh keep and `restart:<seed>` takes the same one again; `start:<seed>` enters the
 * keep a previous visit left. `stick:<x>,<z>` plants the thumbstick and anything unparseable after it
 * is a release, so a lift always lands. `move:`/`stop:` press and release a touch d-pad direction.
 */
export const parseCommand = (detail: string): Command | null => {
  if (detail === 'continue') return { kind: 'continue' };
  if (detail === 'restart' || detail.startsWith('restart:')) return { kind: 'restart', seed: seedAfter(detail, 8) };
  if (detail === 'start' || detail.startsWith('start:')) return { kind: 'start', seed: seedAfter(detail, 6) };
  if (detail === 'map' || detail === 'pause' || detail === 'mute' || detail === 'fullscreen') return { kind: detail };
  if (detail.startsWith('boon:')) return { kind: 'boon', id: detail.slice(5) };
  if (detail.startsWith('stick:')) { const [x, z] = detail.slice(6).split(',').map(Number); return { kind: 'stick', stick: Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null }; }
  if (detail === 'attack' || detail === 'hold-attack' || detail === 'release-attack' || detail === 'dash' || detail === 'swap') return { kind: detail };
  if (detail.startsWith('move:')) return { kind: 'move', action: detail.slice(5) };
  if (detail.startsWith('stop:')) return { kind: 'stop', action: detail.slice(5) };
  return null;
};

/** The cursor in normalised device coordinates over a box, or null for a box with no area. */
export const pointerNdc = (clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }) => {
  if (!rect.width || !rect.height) return null;
  return { x: ((clientX - rect.left) / rect.width) * 2 - 1, y: 1 - ((clientY - rect.top) / rect.height) * 2 };
};

// Standard mapping only. A pad the browser cannot name is a pad whose buttons we would be guessing at,
// and guessing wrong means the dodge button swings.
export const PAD_BUTTONS: [number, Action][] = [[0, 'attack'], [1, 'dash'], [2, 'swap'], [9, 'pause']];
export const PAD_START = 9;
export const PAD_DEADZONE = 0.25;

/**
 * One stick's push, or null inside the deadzone. Rescaled from the edge of the deadzone rather than from
 * zero, or the first usable degree of travel would already be a quarter of full speed.
 */
export const padAxis = (axes: readonly number[], ax: number, az: number): Stick | null => {
  const x = axes[ax] ?? 0, z = axes[az] ?? 0, span = Math.hypot(x, z);
  if (span < PAD_DEADZONE) return null;
  const scale = Math.min(1, (span - PAD_DEADZONE) / (1 - PAD_DEADZONE)) / span;
  return { x: x * scale, z: z * scale };
};

/** The right stick aims and does not move: a screen push turned into a floor heading, or null at rest. */
export const padLook = (axes: readonly number[]) => {
  const look = padAxis(axes, 2, 3);
  return look ? screenHeading(look.x, look.z) : null;
};
