// Bosses that exist only in the tests (plan 021 Stage A): archetypes with moves and phases, built from existing attacks, never dealt.
// `decideEnemy`, `landBlow`, `bossPush` and the balance sim all read the live `BESTIARY`, so a test stands one in for `reaper` - arena
// only, never dealt - and `asReaper` puts the real row back, whatever the test did. The tables built from the rows at import
// (`RECOVERY`, `HOLD_RANGE`, `STRIKE_RANGE`) are not live, so a boss row keeps the reaper's for those; `BASE_STATS` is the one
// the sim builds a body's vitality from, and a boss that dies in three blows measures nothing, so that one is swapped as well.
import { BESTIARY, type Archetype, type Move } from '../../app/dungeon-bestiary.ts';
import { BASE_STATS } from '../../app/dungeon-enemy.ts';

const reaper = BESTIARY.reaper;
const stats = { ...reaper.stats, hp: 10 * 4, damage: 14, tell: 0.9 };
// Steadfast, as a warden is: ordinary steel never breaks its tell, which is what lets it land a blow at all in a fight with the sim's knight.

// The tells are all different, so a test can say which move is winding up from the number alone.
export const SWING: Move = { attack: 'swing', tell: 0.5, damage: 12, strikeRange: 1.9, attackRange: 1.8, cue: { shape: 'arc' }, cueScale: 1.4 };
export const SWEEP: Move = { attack: 'sweep', tell: 0.9, damage: 14, strikeRange: 3.1, attackRange: 2.8, cue: { shape: 'ring', radius: 3.1 }, cueScale: 1 };
export const POUNCE: Move = { attack: 'pounce', tell: 0.6, damage: 10, strikeRange: 1.9, attackRange: 5, cue: { shape: 'lane', length: 5, width: 1.7 }, cueScale: 1 };
export const VOLLEY: Move = { attack: 'volley', tell: 0.7, damage: 9, strikeRange: 9, attackRange: 8, cue: { shape: 'lane', length: 8, width: 1.1 }, cueScale: 1, bolt: { speed: 13, flight: 0.7 } };
export const SCATTER: Move = { attack: 'scatter', tell: 0.8, damage: 0, strikeRange: 0, attackRange: 8, cue: { shape: 'ring', radius: 1.7 }, cueScale: 1, scatter: { rings: 3, pool: { radius: 1.7, life: 3.5, damage: 8, interval: 0.6 } } };

/** Two phases: swing and sweep, then at half a swing, a pounce and a sweep. Its largest melee reach is the sweep's 3.1. */
export const TEST_BOSS: Archetype = { ...reaper, stats, steadfast: true, boss: 'pool', moves: [[SWING, SWEEP], [SWING, POUNCE, SWEEP]], phases: [0.5] };
/** Three phases, changing at 60% and 25%. */
export const TEST_KING: Archetype = { ...reaper, stats, steadfast: true, boss: 'final', moves: [[SWING, SWEEP], [SWING, POUNCE], [SWEEP]], phases: [0.6, 0.25] };
/** One phase that does nothing but scatter. */
export const TEST_SCATTERER: Archetype = { ...reaper, stats, steadfast: true, boss: 'pool', moves: [[SCATTER]], phases: [] };

/** Runs `run` with `row` standing in for the reaper, and puts the reaper back afterwards. */
export const asReaper = <T>(row: Archetype, run: () => T): T => {
  const had = BESTIARY.reaper, hadStats = BASE_STATS.reaper;
  BESTIARY.reaper = row; BASE_STATS.reaper = row.stats;
  try { return run(); } finally { BESTIARY.reaper = had; BASE_STATS.reaper = hadStats; }
};
