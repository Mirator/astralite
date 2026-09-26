import { BESTIARY, LUNGE_TIME, RECOVERY, type EnemyKind } from './dungeon-enemy.ts';

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
  // `stalker` and `warden` name the two bodies these styles were drawn for; any kind wearing the style moves the same way.
  const style = BESTIARY[kind].look.pose, stalker = style === 'pounce', warden = style === 'overhead';
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
  const recoveryLength = warden ? .72 : stalker ? Math.max(.01, RECOVERY[kind] - LUNGE_TIME) : .34;
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

  if (style === 'spin') {
    // The scythe comes up and the body winds back over the tell; on release the whole body turns once,
    // blade flat, and settles. The turn ends where it began (a full circle), which is why the yaw drops
    // back to zero after it rather than easing there.
    const spinTime = .28;
    const spinning = !winding && hasAttackAge && age < spinTime;
    const windYaw = -.6 * charge;
    const bodyYaw = winding ? windYaw : spinning ? -.6 + (Math.PI * 2 + .6) * smooth(age / spinTime) : 0;
    const settle = hasAttackAge ? smooth(age / .7) : 1;
    const weapon = winding ? mix(.2, 1.0, charge) : hasAttackAge ? (age < .08 ? mix(1.0, -.2, smooth(age / .08)) : mix(-.2, .2, settle)) : .2;
    const arms = winding ? .4 * charge : hasAttackAge ? .4 * (1 - settle) : 0;
    return { pitch: winding ? -.06 * charge : hasAttackAge ? -.06 * (1 - settle) : 0, height: 0, weapon, arms, recovery, weaponYaw: 0, weaponRoll: 0, bodyYaw, trail: spinning };
  }

  if (style === 'channel') {
    // Both arms and the staff go up over the tell; the call itself is a small start back, and then they
    // come down.
    const raised = winding ? charge : hasAttackAge ? 1 - smooth(age / .5) : 0;
    const kick = !winding && hasAttackAge ? Math.sin(Math.PI * clamp01(age / .15)) : 0;
    return { pitch: .08 * raised + .06 * kick, height: 0, weapon: mix(.1, 1.0, raised), arms: 2.4 * raised, recovery, weaponYaw: 0, weaponRoll: 0, bodyYaw: 0, trail: false };
  }

  if (style === 'sink') {
    // It goes down into the floor over the tell, blade already raised, and comes up on its mark cutting:
    // every channel ends the tell where the rise begins, so the arrival is one motion and not a pop.
    const under = winding ? smooth(charge) : hasAttackAge ? 1 - smooth(age / .14) : 0;
    const settle = hasAttackAge ? smooth(age / .34) : 1;
    const weapon = winding ? mix(.1, 1.4, charge) : hasAttackAge ? (age < .1 ? mix(1.4, -.7, smooth(age / .1)) : mix(-.7, .1, settle)) : .1;
    const arms = winding ? .5 * charge : hasAttackAge ? .5 * (1 - settle) : 0;
    return { pitch: -.2 * under, height: -1.7 * under, weapon, arms, recovery, weaponYaw: 0, weaponRoll: 0, bodyYaw: 0, trail: !winding && hasAttackAge && age < .12 };
  }

  if (style === 'draw') {
    // A bow is raised, not swung. Over the tell it comes up from the hip to level while both arms reach
    // out to it and the body turns side-on; the release is a short kick back, and then it lowers again on
    // the same recovery a guard's blade settles on. No ribbon: nothing sweeps, and the bolt is its own mark.
    const drawn = winding ? charge : hasAttackAge ? 1 - smooth(age / .45) : 0;
    const kick = !winding && hasAttackAge ? Math.sin(Math.PI * clamp01(age / .12)) : 0;
    return {
      pitch: .05 * drawn + .08 * kick,
      height: 0,
      weapon: mix(-1, 0, drawn),
      arms: 1.3 * drawn - .18 * kick,
      recovery,
      weaponYaw: 0,
      weaponRoll: 0,
      bodyYaw: -.22 * drawn,
      trail: false,
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
