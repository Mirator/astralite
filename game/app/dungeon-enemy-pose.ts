import { LUNGE_TIME, RECOVERY, type EnemyKind } from './dungeon-enemy.ts';

// Presentation only: read the combat clock, never advance it or decide a hit. `attackAge` is
// deliberately separate from cooldown: cooldown also exists at spawn and after a flinch, neither of
// which should make an enemy look as though it has just swung.
const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const smooth = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, amount: number) => a + (b - a) * clamp01(amount);
const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export type EnemyPose = {
  pitch: number;
  height: number;
  weapon: number;
  arms: number;
  recovery: number;
  weaponYaw: number;
  weaponRoll: number;
  bodyYaw: number;
  // The renderer samples a ribbon only during the short visible release window.
  trail: boolean;
};

export function enemyPose(kind: EnemyKind, windup: number, tell: number, cooldown: number, lunge: number, attackAge = Infinity): EnemyPose {
  const stalker = kind === 'stalker', warden = kind === 'warden';
  const safeWindup = Math.max(0, finiteOr(windup, 0));
  const safeTell = Math.max(0.001, finiteOr(tell, .5));
  const safeCooldown = Math.max(0, finiteOr(cooldown, 0));
  const safeLunge = Math.max(0, finiteOr(lunge, 0));
  // Infinity is the explicit idle value. A finite age is the only evidence that a release happened;
  // this keeps a .4s spawn cooldown and a hit-flash cooldown from being rendered as recovery.
  const hasAttackAge = Number.isFinite(attackAge) && attackAge >= 0;
  const age = hasAttackAge ? attackAge : Infinity;
  const winding = safeWindup > 0;
  const charge = smooth(winding ? 1 - safeWindup / safeTell : 1);
  const releaseWindow = warden ? .12 : .09;
  const lateRelease = winding ? clamp01(1 - safeWindup / releaseWindow) : 1;
  const releaseEase = smooth(lateRelease);
  // A pounce can end its damage movement early on contact. Keep using the release age for its visual
  // hop until the original landing time, so stopping world movement never snaps the claws back.
  const airborne = stalker && (safeLunge > 0 || hasAttackAge && age < LUNGE_TIME);
  const lungeProgress = airborne
    ? hasAttackAge ? clamp01(age / LUNGE_TIME) : clamp01(1 - safeLunge / LUNGE_TIME)
    : 1;
  const lungeEase = smooth(lungeProgress);
  const followthrough = warden ? .16 : .12;
  const recoveryLength = warden ? .72 : stalker ? Math.max(.01, RECOVERY.stalker - LUNGE_TIME) : .34;
  const landedAge = stalker ? Math.max(0, age - LUNGE_TIME) : age;
  const recovery = !winding && hasAttackAge && !airborne
    ? 1 - smooth(landedAge / recoveryLength)
    : 0;
  const impact = !winding && hasAttackAge ? Math.sin(Math.PI * clamp01(age / followthrough)) : 0;

  if (stalker) {
    const coil = winding ? charge : 0;
    const launchArms = airborne ? mix(-.55, 1.3, lungeEase) : 0;
    const landedArms = !airborne && hasAttackAge ? mix(1.3, 0, smooth(landedAge / recoveryLength)) : 0;
    const attackArms = winding ? -.55 * coil : airborne ? launchArms : landedArms;
    const attackPitch = winding ? -.38 - coil * .28 : airborne ? mix(-.66, -.36, lungeEase) : hasAttackAge ? mix(-.36, -.38, smooth(landedAge / recoveryLength)) : -.38;
    const attackHeight = winding ? -.18 - coil * .16 : airborne ? -.34 + Math.sin(Math.PI * lungeProgress) * .22 : hasAttackAge ? mix(-.34, -.18, smooth(landedAge / recoveryLength)) : -.18;
    const clawTrail = airborne && lungeProgress < .42;
    return {
      pitch: attackPitch,
      height: attackHeight,
      weapon: .1,
      arms: attackArms,
      recovery,
      weaponYaw: 0,
      weaponRoll: 0,
      bodyYaw: 0,
      trail: clawTrail,
    };
  }

  const restWeapon = warden ? .45 : .1;
  const raisedWeapon = restWeapon + charge * (warden ? 1.85 : 1.55);
  // The final few tell frames are the cut itself. Its start is exactly the same raised pose as the
  // preceding frame, and at windup zero it reaches the old contact angle, so the combat hit boundary
  // and the visible blade crossing stay in lockstep.
  const contactWeapon = warden ? -.8 : -.7;
  const attackWeapon = winding
    ? safeWindup < releaseWindow ? mix(raisedWeapon, contactWeapon, releaseEase) : raisedWeapon
    : contactWeapon;
  const settleWeapon = mix(contactWeapon, restWeapon, smooth(landedAge / (warden ? .72 : .34)));
  const followWeapon = settleWeapon - impact * (warden ? .3 : .24);
  const weapon = winding ? attackWeapon : hasAttackAge ? followWeapon : restWeapon;

  // A guard cuts across the body, while a warden carries the hammer over the crown and lets it drop.
  // Each channel shares the same attack envelope, making the release continuous at windup === 0.
  const envelope = winding ? charge : hasAttackAge ? 1 - smooth(landedAge / (warden ? .72 : .34)) : 0;
  const arc = envelope + impact * (warden ? .08 : .16);
  const windPitch = warden ? charge * .18 : charge * .1;
  const contactPitch = warden ? -.1 : -.08;
  const windHeight = 0, contactHeight = warden ? -.07 : -.025;
  const windArms = charge * (warden ? .52 : .5), contactArms = warden ? .9 : .78;
  const late = winding && safeWindup < releaseWindow;
  const pitch = winding ? (late ? mix(windPitch, contactPitch, releaseEase) : windPitch) : hasAttackAge ? contactPitch * recovery : 0;
  const height = winding ? (late ? mix(windHeight, contactHeight, releaseEase) : windHeight) : -recovery * (warden ? .07 : .025);
  const arms = winding ? (late ? mix(windArms, contactArms, releaseEase) : windArms) : hasAttackAge ? recovery * contactArms : 0;
  const weaponYaw = (warden ? .14 : .88) * arc;
  const weaponRoll = (warden ? -.18 : .34) * arc;
  const bodyYaw = (warden ? -.1 : .16) * arc;
  const trail = winding ? lateRelease > 0 : hasAttackAge && age < followthrough;
  // Keep the old cooldown read in the function's input contract while making it intentionally irrelevant
  // to pose state. This assignment documents that an idle cooldown is not an implicit attack age.
  void safeCooldown;
  return { pitch, height, weapon, arms, recovery, weaponYaw, weaponRoll, bodyYaw, trail };
}
