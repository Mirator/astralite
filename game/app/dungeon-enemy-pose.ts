import { LUNGE_TIME, RECOVERY, type EnemyKind } from './dungeon-enemy.ts';

// Presentation only: read the combat clock, never advance it or decide a hit.
export function enemyPose(kind: EnemyKind, windup: number, tell: number, cooldown: number, lunge: number) {
  const stalker = kind === 'stalker', warden = kind === 'warden';
  const charge = windup > 0 ? Math.min(1, Math.max(0, 1 - windup / tell)) : 0;
  const release = Math.max(0, RECOVERY[kind] - cooldown);
  const recoveryLength = warden ? .72 : .34;
  const recovery = windup <= 0 && cooldown > 0 ? Math.max(0, 1 - release / recoveryLength) : 0;
  const airborne = lunge > 0;
  return {
    pitch: stalker ? (airborne ? -.7 : -.38 - charge * .28 - recovery * .12) : (windup > 0 ? charge * .13 : -recovery * (warden ? .32 : .12)),
    height: stalker ? -.18 - charge * .16 + (airborne ? Math.sin(lunge / LUNGE_TIME * Math.PI) * .22 : 0) : -recovery * (warden ? .07 : .025),
    weapon: windup > 0 ? .25 + charge * (warden ? 1.8 : 1.35) : (warden ? .45 : .1) - recovery * (warden ? 1.25 : .8),
    arms: stalker ? (airborne ? 1.3 : charge * -.55 + recovery * .7) : (windup > 0 ? charge * .5 : recovery * .85),
    recovery,
  };
}
