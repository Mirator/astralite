'use client';

import { ARENA_MAX, rosterOf, type Arena, type ArenaPick } from './dungeon-arena';
import { ENEMY_KINDS, type EnemyKind } from './dungeon-bestiary';
import { enemyStats } from './dungeon-enemy';

// The arena page of the menu (development only): how many of each kind, which floor's numbers they carry,
// and FIGHT. It asks the world closure through the `dungeon-arena` event rather than `dungeon-action`, whose
// listener dungeon-game.tsx installs only outside production, so neither this page nor the event ships.

const ask = (detail: Arena | null) => window.dispatchEvent(new CustomEvent('dungeon-arena', { detail }));

/** The pick lives with the menu's owner, so coming back to tune one count does not reset the others. */
export type ArenaChoice = { pick: ArenaPick; level: number };

export default function ArenaPanel({ floors, choice, choose }: { floors: number; choice: ArenaChoice; choose: (next: ArenaChoice) => void }) {
  const { pick, level } = choice;
  const roster = rosterOf(pick);
  const count = (kind: EnemyKind) => pick[kind] ?? 0;
  const set = (kind: EnemyKind, value: number) => choose({ pick: { ...pick, [kind]: Math.max(0, value) }, level });
  return <div className="menu-details arena-panel">
    <p>Meet a chosen roster in the gate of an empty floor. The stair stays open; taking it brings the same roster a floor deeper.</p>
    {ENEMY_KINDS.map(kind => {
      const stats = enemyStats(kind, level);
      return <div className="setting-row arena-row" key={kind}>
        <label id={`arena-${kind}`}>{kind}</label>
        <fieldset className="arena-count" aria-labelledby={`arena-${kind}`}>
          <button aria-label={`One fewer ${kind}`} disabled={count(kind) === 0} onClick={() => set(kind, count(kind) - 1)}>−</button>
          <output aria-live="polite">{count(kind)}</output>
          <button aria-label={`One more ${kind}`} disabled={roster.length >= ARENA_MAX} onClick={() => set(kind, count(kind) + 1)}>+</button>
        </fieldset>
        <small>{stats.hp} vitality · {stats.damage} a blow</small>
      </div>;
    })}
    <div className="setting-row"><label htmlFor="arena-level">Floor</label><select id="arena-level" value={level} onChange={(e) => choose({ pick, level: Number(e.target.value) })}>{Array.from({ length: floors }, (_, i) => <option key={i} value={i + 1}>Floor {i + 1}</option>)}</select><small>up to {ARENA_MAX} bodies</small></div>
    <div className="arena-actions">
      <button className="primary-action" disabled={!roster.length} onClick={() => ask({ roster, level })}>FIGHT · {roster.length} <span>→</span></button>
      <button className="reset-binds" onClick={() => ask(null)}>Ordinary keep</button>
    </div>
  </div>;
}
