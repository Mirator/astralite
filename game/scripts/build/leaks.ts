// What must never reach the production bundle: every hook dungeon-game.tsx hangs on `testHooks` inside its
// `NODE_ENV !== 'production'` block, and the `?boot=eager` switch beside it (matched as the minified
// `get(`boot`)` read, since the literal `boot=eager` appears nowhere in the source). The bundler drops that block
// because NODE_ENV is inlined; nothing else checked that it still does. Pure, so the node suite runs it.

/** Names the development-only block assigns (`testHooks.name = ...`), read off the source itself so a hook
 * added there is guarded without anyone remembering to list it. */
export function devOnlyHooks(source: string): string[] {
  return [...new Set([...source.matchAll(/\btestHooks\.(\w+)\s*=/g)].map((m) => m[1]))].sort();
}

/** Always shipped: the hooks the README documents for the console. Seeing them proves the game chunk was read. */
export const PUBLIC_HOOKS = ['render_game_to_text', 'advanceTime', 'dungeonTest'] as const;

export type LeakReport = { leaked: string[]; missingPublic: string[] };

/** The eager-boot switch as the minifier writes it: `get(\`boot\`)`, whichever quote it picks. */
const EAGER_BOOT = /\bget\(\s*[`'"]boot[`'"]\s*\)/;

export function findLeaks(bundle: string, devOnly: string[]): LeakReport {
  return {
    leaked: [...devOnly.filter((name) => bundle.includes(name)), ...(EAGER_BOOT.test(bundle) ? ['?boot=eager'] : [])],
    missingPublic: PUBLIC_HOOKS.filter((name) => !bundle.includes(name)),
  };
}
