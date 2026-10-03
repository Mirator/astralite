// A scripted fight for each ordinary kind, replayed through `decideEnemy` the way the game feeds it back: every
// intent's x, z, cooldown, windup, lunge, aim and notice become the next frame's view. `tests/dungeon-enemy.test.ts`
// holds the result of this driver, taken from the code as it stood before plan 021 gave an archetype moves and
// phases (at 1ae7e92), against a literal. The driver reads only what that code returned, so it can be replayed
// against any later version: if an ordinary body's intents ever change, the digest does.
import { decideEnemy, enemyStats, hitCooldown, interruptsWindup, type EnemyKind, type EnemyView, type World } from '../../app/dungeon-enemy.ts';
import { cellKey, TILE } from '../../app/dungeon-floor.ts';

export const SEQUENCE_SECONDS = 40, SEQUENCE_DT = 1 / 60;
// Every body is handed a tell a quarter longer than its kind's own. The view is where an ordinary body reads its tell from
// (`EnemyView.tell`), and a rule that took it from the archetype instead would agree with the bestiary and disagree with this.
const TELL = 1.25;

export type Recorded = { kind: EnemyKind; digest: string; frames: number; windups: number; hits: number; looses: number; raises: number; lunges: number; noticing: number; ready: number; dozing: number };

const r6 = (value: number) => Math.round(value * 1e6) / 1e6;

// 32-bit FNV-1a over a string: small, dependency-free, and the same in every process.
const fnv = (text: string) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };

// Open floor with a two-tile pillar in it, so a clear line and a flood step both have something to decide.
const cells = (() => {
  const set = new Set<string>();
  for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) if (!(x >= 3 && x <= 4 && z >= 0 && z <= 1)) set.add(cellKey(x, z));
  return set;
})();

/** The knight's path: in and out between 0.5 and 6.5 units while circling, so every range an ordinary kind cares about is crossed. */
const knightAt = (t: number) => { const radius = 3.5 + 3 * Math.sin(t * 0.45), angle = t * 0.7; return { x: radius * Math.cos(angle), z: radius * Math.sin(angle) }; };

export function recordSequence(kind: EnemyKind): Recorded {
  const stats = enemyStats(kind, 1);
  let enemy = { kind, x: 0, z: 0, room: 1, cooldown: 0.4, hitFlash: 0, windup: 0, lunge: 0, tell: TELL * stats.tell, speed: stats.speed, aim: { x: 1, z: 0 }, anchor: { x: 0, z: 0 }, notice: 0, hp: 100, maxHp: 100, move: 0, phase: 0, change: 0 } as EnemyView;
  const lines: string[] = [], count = { windups: 0, hits: 0, looses: 0, raises: 0, lunges: 0, noticing: 0, ready: 0, dozing: 0 };
  const frames = Math.round(SEQUENCE_SECONDS / SEQUENCE_DT);
  for (let i = 0; i < frames; i++) {
    const t = i * SEQUENCE_DT, knight = knightAt(t), cellX = Math.round(knight.x / TILE), cellZ = Math.round(knight.z / TILE);
    // From 25 s to 28.3 s the knight is in no room at all and out of reach, so a body paces its post and then notices him afresh.
    const away = i >= 1500 && i < 1700, world: World = away ? { cells, activeRoom: -1, pathDistance: () => Infinity } : { cells, activeRoom: 1, pathDistance: (x, z) => Math.abs(x - cellX) + Math.abs(z - cellZ) };
    // Every 3.1 s a plain blow lands, and every 11 s a stagger one: a windup still early enough to break is broken, as `landBlow` does.
    const blow = i > 0 && i % 186 === 0 ? 'plain' : i > 0 && i % 660 === 0 ? 'stagger' : null;
    if (blow) {
      const stagger = blow === 'stagger', broke = interruptsWindup(kind, enemy.windup, stagger);
      enemy = { ...enemy, hitFlash: 0.2, windup: broke ? 0 : enemy.windup, cooldown: Math.max(enemy.cooldown, hitCooldown(kind, broke, stagger)) };
    }
    const before = enemy.windup, intent = decideEnemy(enemy, knight, world, SEQUENCE_DT);
    if (before <= 0 && intent.windup > 0) count.windups++;
    if (intent.hit) count.hits++;
    if (intent.loose) count.looses++;
    if (intent.raise) count.raises++;
    if (intent.act === 'lunge') count.lunges++;
    if (intent.act === 'noticing') count.noticing++;
    if (intent.act === 'ready') count.ready++;
    if (intent.act === 'dozing') count.dozing++;
    lines.push(JSON.stringify([intent.act, r6(intent.x), r6(intent.z), r6(intent.cooldown), r6(intent.hitFlash), r6(intent.windup), r6(intent.lunge), r6(intent.aim.x), r6(intent.aim.z), r6(intent.notice), intent.face === null ? null : r6(intent.face), intent.hit, intent.loose ? [r6(intent.loose.x), r6(intent.loose.z)] : null, intent.raise, intent.sound, r6(intent.distance)]));
    enemy = { ...enemy, x: intent.x, z: intent.z, cooldown: intent.cooldown, hitFlash: intent.hitFlash, windup: intent.windup, lunge: intent.lunge, aim: intent.aim, notice: intent.notice };
  }
  return { kind, digest: fnv(lines.join('\n')), frames, ...count };
}
