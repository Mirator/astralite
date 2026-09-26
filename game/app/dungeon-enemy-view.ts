import * as THREE from 'three';
import { advanceDeath, type DeathAnimation } from './dungeon-death';
import { enemyStats, NOTICE_TIME, type EnemyIntent } from './dungeon-enemy';
import { enemyPose } from './dungeon-enemy-pose';
import type { Spawn } from './dungeon-floor';
import { BONES, makeSkeleton } from './dungeon-skeleton';
import { weaponTrail } from './dungeon-weapon-trail';

// A skeleton as the renderer holds it: the rig, its telegraph, its health bar, its alert glyph and its
// weapon trails, plus the handful of numbers `decideEnemy` is fed back each frame. What a body *does* is
// decided in dungeon-enemy.ts; this file builds the body and puts the decision on screen. Both halves
// used to sit inline in the world closure in dungeon-game.tsx.

export type EnemyKind = 'guard' | 'stalker' | 'warden';
export type Enemy = { group: THREE.Group; hp: number; speed: number; cooldown: number; hitFlash: number; dead: boolean; death: DeathAnimation | null; phase: number; windup: number; lunge: number; aim: THREE.Vector3; room: number; kind: EnemyKind; awake: boolean; maxHp: number; tell: number; damage: number; cue: THREE.Mesh; bar: THREE.Mesh; alert: THREE.Sprite; attackAge: number; trails: { effect: ReturnType<typeof weaponTrail>; anchor: THREE.Object3D; inner: THREE.Vector3; tip: THREE.Vector3 }[];
  // Where it spawned, for a dozing body's pace; how far into noticing it is; a countdown to a contagion
  // kick a neighbour scheduled for it, or Infinity while none is pending. scripts/balance/sim.ts carries
  // the identical bookkeeping so a room wakes the same way in both sims.
  anchor: { x: number; z: number }; notice: number; alertIn: number };

/**
 * The two colours a blow is told in, and the only two in the keep no chamber is allowed to take.
 *
 * `THREAT` is every windup, of every kind, in every theme. It sits at H8, eighteen degrees off the
 * hottest fire any family burns and clear of the other two entirely, and it wins the one contest that
 * matters on hardness and brightness rather than on hue: a hard-edged arc closing on the body, drawn
 * opaque and above the tone-mapped range, against stone that has none of those three properties.
 *
 * `COMMIT` is the single frame it lands on, stamped on the mark and on the body together. Before this
 * the tell was an opacity ramp from .2 to .7 at a fixed size, which says that something is happening
 * but never says when — and when is the whole question.
 */
export const THREAT = 0xff4529, COMMIT = 0xffd6c2;

/** The shared art every body on a floor is drawn with. */
export type EnemyArt = { telegraph: THREE.Texture; lane: THREE.Texture; alert: THREE.SpriteMaterial };

/** Builds one spawn's body, its marks and its trails into `group`, and returns the record the loop drives. */
export const spawnEnemy = (spawn: Spawn, index: number, level: number, group: THREE.Group, art: EnemyArt, tile: number): Enemy => {
  const kind = spawn.kind;
  const stats = enemyStats(kind, level), maxHp = stats.hp, tell = stats.tell;
  const body = makeSkeleton(kind); body.position.set(spawn.x * tile,0.03,spawn.z * tile); body.visible = !spawn.ambush; group.add(body);
  if (kind === 'warden') body.scale.setScalar(1.3);
  if (kind === 'stalker') body.scale.set(.94,1,.94);
  // One colour for all three kinds. Which body is winding up is already answered by the shape —
  // the stalker's long lane against the others' arc — and by the eye it is answered with, so the
  // two amber tells this replaced were spending hue on a question nobody was asking and spending
  // it in the same band the torches burn in. `toneMapped` and `fog` off: this is the one
  // mark in the keep the player answers on a deadline, and it has no business being compressed by
  // the same curve as the wall behind it or dimmed by the distance it is seen from.
  // Opaque over the floor rather than added to it, and drawn through whatever stands in the way.
  //
  // Additive was the obvious choice and it was wrong, measurably: the result is floor plus red,
  // so the paving's own green and blue survive underneath and set the hue. The same `0xff4529`
  // came out dusty pink over the keep's violet slate and muddy orange-brown over the flood's
  // teal — the two families whose fire was moved off amber precisely to leave red free. A mark
  // whose colour is decided by the room it is drawn in is not a signal. Normal blending at a
  // high opacity carries its own colour instead, and `toneMapped: false` writes it through
  // unchanged, so the tell is the same red in all three chambers.
  //
  // Two passes of one shape, which is how a mark stays a mark behind a pier.
  //
  // Depth-tested alone, a plinth or a column between the lens and a body ate part of the arc and,
  // in the drowned chambers, most of it. Depth-test off alone was worse: a hot arc painted over
  // solid stone makes the stone look like glass and smears the knight it crosses. So the solid
  // pass keeps its depth test and belongs to the world, and a faint copy behind it does not — at
  // a third of the opacity it is invisible wherever the real arc already shows and a red ghost
  // wherever something is standing in front of it. Seen through, rather than not seen.
  //
  // Full opacity on the solid pass, not the .88 a first cut used. At .88 the mark tops out around
  // 94 of a possible 100 while a brazier's core clips at 100, which is the one thing a signal
  // carrying a deadline may not do: be dimmer than the furniture. `toneMapped: false` buys the
  // headroom and the opacity was giving it straight back.
  const cueGeometry = kind === 'stalker' ? new THREE.PlaneGeometry(5,1.7).translate(2.5,0,0) : BONES.cue;
  // Plan 014 round 2: toneMapped is true here now (it was false). `THREAT` was drawn
  // above the tone-mapped range on purpose while the mark was an opaque slab that had to win
  // against any floor under it; translucent, it only needs to read as red, and a
  // never-compressed value alpha-blended over a lit floor is exactly what was clearing the
  // post chain's bloom threshold and blowing the whole shape out to white.
  // Plan 014 round 4 (lever B3) tried additive blending here on the theory that it would let
  // the stone underneath stay visible; round 5's critic instead read the result as laser lines
  // crossing the room. Back to `NormalBlending` (the default - no `blending` key at all) with a
  // texture that carries its own soft, capped-alpha gradient (see `telegraphTexture`), which is
  // what actually keeps the stone visible without needing additive's unbounded stacking.
  const cueMap = kind === 'stalker' ? art.lane : art.telegraph;
  const cue = new THREE.Mesh(cueGeometry,new THREE.MeshBasicMaterial({color:THREAT,map:cueMap,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,fog:false}));cue.rotation.x=-Math.PI/2;cue.renderOrder=9;group.add(cue);
  const ghost = new THREE.Mesh(cueGeometry,new THREE.MeshBasicMaterial({color:THREAT,map:cueMap,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,depthTest:false,fog:false}));ghost.renderOrder=8;cue.add(ghost);
  const bar = new THREE.Mesh(BONES.bar,new THREE.MeshBasicMaterial({color:kind === 'warden'?0xffb65f:0xe89a79,depthTest:false,toneMapped:false,fog:false}));bar.renderOrder=10;group.add(bar);
  // Plan 014 round B: a framed bar - a dark border plate with a darker track behind the fill, as a
  // child of the fill counter-scaled every frame (below), so it stays full width while the fill
  // drains from the right.
  const barFrame = new THREE.Mesh(new THREE.PlaneGeometry(.88,.15),new THREE.MeshBasicMaterial({color:0x6b5a3e,depthTest:false,toneMapped:false,fog:false}));barFrame.renderOrder=9;barFrame.position.z=-.001;
  const barTrack = new THREE.Mesh(new THREE.PlaneGeometry(.82,.09),new THREE.MeshBasicMaterial({color:0x120b0a,depthTest:false,toneMapped:false,fog:false}));barTrack.renderOrder=9;barTrack.position.z=.0005;barFrame.add(barTrack);bar.add(barFrame);
  const alert = new THREE.Sprite(art.alert);alert.scale.set(.55,.55,1);alert.visible=false;alert.renderOrder=10;group.add(alert);
  const anchors:THREE.Object3D[]=kind==='stalker'?body.userData.limbs.slice(0,2):[body.userData.weapon];
  const trails=anchors.map(anchor=>{const effect=weaponTrail(kind==='warden'?0xffa15c:kind==='stalker'?0xffcc90:0xffd39b,kind==='warden'?.13:.095);group.add(effect.mesh);return {effect,anchor,inner:kind==='stalker'?new THREE.Vector3(0,-.72,-.12):new THREE.Vector3(0,0,-.24),tip:kind==='stalker'?new THREE.Vector3(0,-.87,-.5):new THREE.Vector3(0,0,kind==='warden'?-1.2:-.86)};});
  return { group: body, hp:maxHp, maxHp, kind, tell, damage:stats.damage, cue, bar, alert, trails, attackAge:Infinity, speed:stats.speed, cooldown:0.4+(index%3)*0.2, hitFlash:0, dead:false, death:null, phase:spawn.room*1.7+index*0.6, windup:0, lunge:0, aim:new THREE.Vector3(), room:spawn.room, awake:!spawn.ambush, anchor:{x:spawn.x*tile,z:spawn.z*tile}, notice:0, alertIn:Infinity };
};

/** A body that has gone quiet, whether dormant or unrendered this frame: no mark, no bar, no glyph. */
export const hideMarks = (enemy: Enemy) => { enemy.cue.visible = false; enemy.bar.visible = false; enemy.alert.visible = false; enemy.trails.forEach(trail=>trail.effect.clear()); };

/** Stops drawing everything a living body wears, for the frame it dies on. */
export const dropMarks = (enemy: Enemy) => { enemy.cue.visible = enemy.bar.visible = enemy.alert.visible = false; enemy.trails.forEach(trail => trail.effect.clear()); };

const barLift = new THREE.Vector3(), alertLift = new THREE.Vector3(), barRight = new THREE.Vector3();

/**
 * The marks an awake body wears this frame - its health bar facing the lens, its alert glyph, and its
 * telegraph converging on the strike - drawn off the state the last decision left. A corpse only runs
 * its fall from here on; returns false for one, so the caller skips the decision.
 */
export const markEnemy = (enemy: Enemy, camera: THREE.Camera, dt: number) => {
  enemy.cue.visible = !enemy.dead && (enemy.windup > 0 || enemy.lunge > 0); enemy.bar.visible = !enemy.dead && enemy.hp < enemy.maxHp;
  enemy.bar.position.copy(enemy.group.position).add(barLift.set(0,enemy.kind === 'warden'?2.65:2.05,0)); enemy.bar.quaternion.copy(camera.quaternion); const fill = Math.max(.001, enemy.hp / enemy.maxHp); enemy.bar.scale.x = fill;
  // Left-anchored: the fill shifts left as it shrinks, and its frame child is counter-scaled and
  // counter-shifted so it stays put at full width.
  enemy.bar.position.addScaledVector(barRight.set(1,0,0).applyQuaternion(camera.quaternion), -(1 - fill) * .4);
  const frame = enemy.bar.children[0]; if (frame) { frame.scale.x = 1 / fill; frame.position.x = (1 - fill) * .4 / fill; }
  // Plan 014 round 2 (lever D10): the alert glyph lives exactly in the noticing window - after
  // the decision sets `notice` above zero and before it reaches `NOTICE_TIME`, which is the same beat
  // `decideEnemy` holds a body at before it is `awake` enough to begin its own tell. That is "just
  // seen you" as a number already in this loop, not a new timer to invent.
  enemy.alert.visible = enemy.notice > 0 && enemy.notice < NOTICE_TIME;
  enemy.alert.position.copy(enemy.group.position).add(alertLift.set(0, enemy.kind === 'warden' ? 3.15 : 2.55, 0));
  // The clock. `close` runs 0 at the start of the tell to 1 on the strike, and the mark converges
  // over it: it opens at nearly twice the reach the blow actually has and shuts onto the body, so
  // what is left to run is a distance on the floor.
  //
  // The opacity ramp is gone. A first pass kept one alongside a quarter-scale convergence and it
  // was the worst of both — a quarter is under the threshold at which a mark moving with its own
  // body reads as closing at all, and the fade underneath was doing what the whole rewrite exists
  // to stop doing. The mark arrives at full strength and the only thing that changes is its size.
  const close = enemy.windup > 0 ? 1 - enemy.windup / enemy.tell : 1;
  enemy.cue.scale.setScalar((enemy.kind === 'warden' ? 1.7 : 1) * (1.9 - .9 * close));
  enemy.cue.position.copy(enemy.group.position); enemy.cue.position.y = 0.055; enemy.cue.rotation.z = Math.atan2(-enemy.aim.z,enemy.aim.x);
  const cueSkin = enemy.cue.material as THREE.MeshBasicMaterial;
  // Plan 014 round 2: this was 1 - a fully opaque slab, drawn for the whole tell, wide enough
  // in the stalker's case to cover half a room and swallow every body standing on it. The
  // texture's own alpha channel now carries the fill/rim/pattern shape (see
  // `telegraphTexture`), so the material only has to hold a modest overall multiplier.
  cueSkin.opacity = .92; cueSkin.color.setHex(THREAT);
  const cueGhost = enemy.cue.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  cueGhost.material.opacity = .16; cueGhost.material.color.setHex(THREAT);
  if (enemy.dead) { if(enemy.death)advanceDeath(enemy.death,dt);return false; }
  return true;
};

/**
 * Puts a decision on the body: its pose, gait and facing, the landed blow's one frame of `COMMIT`, its
 * weapon trails and the flare of a fresh hit. `t` is the world clock; `elapsed` is the one hit-stop does
 * not touch, which the flare is stamped against.
 */
export const poseEnemy = (enemy: Enemy, intent: EnemyIntent, dt: number, t: number, elapsed: number) => {
  const pose=enemyPose(enemy.kind,enemy.windup,enemy.tell,enemy.cooldown,enemy.lunge,enemy.attackAge);
  if(!pose.trail)enemy.group.rotation.y=intent.face??enemy.group.rotation.y;
  const walking=intent.act==='dozing'||(intent.act==='ready'&&intent.distance>1.15&&enemy.hitFlash<=0&&pose.recovery===0);
  const gait=walking?Math.sin(t*enemy.speed*5+enemy.phase)*(enemy.kind==='warden'?.28:.48):0;
  enemy.group.position.y=.03;
  enemy.group.userData.rig.position.y=pose.height+(walking?Math.abs(gait)*.07:0);
  enemy.group.userData.rig.rotation.x=pose.pitch+(enemy.hitFlash>0?.15:0);
  enemy.group.userData.rig.rotation.y=pose.bodyYaw;
  enemy.group.userData.weapon.rotation.set(pose.weapon,pose.weaponYaw,pose.weaponRoll);
  enemy.group.userData.limbs.forEach((limb:THREE.Group,i:number)=>{limb.rotation.x=(i<2?pose.arms:0)+(i%2?gait:-gait);});
  enemy.group.userData.skull.rotation.y=Math.sin(t*1.5+enemy.phase)*.06;
  if(enemy.kind==='guard')enemy.group.userData.limbs[0].rotation.x=-.16+gait*.12-.1*(enemy.windup>0?1-enemy.windup/enemy.tell:pose.recovery);
  enemy.cue.visible=enemy.windup>0||(enemy.lunge>0&&enemy.attackAge<.09);
  // Landed. The mark is at its tightest already, so the last thing it does is stop being the
  // warning and become the blow: one frame of `COMMIT` on the floor while the body carries the
  // same flare above it, then out inside a tenth of a second.
  if(enemy.windup<=0){const fade=Math.max(0,1-enemy.attackAge/.09);const skin=enemy.cue.material as THREE.MeshBasicMaterial;skin.color.setHex(COMMIT);skin.opacity=fade;const gh=enemy.cue.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;gh.material.color.setHex(COMMIT);gh.material.opacity=fade*.34;enemy.cue.scale.setScalar(enemy.kind==="warden"?1.7:1);}
  enemy.trails.forEach(trail=>trail.effect.update(dt,pose.trail,trail.anchor,trail.inner,trail.tip));
  // A struck body flares for two frames and is back to its own colour inside six. The flat 0.8
  // this replaced held an orange tint for the whole 0.2s of hitFlash, which is fifteen frames of
  // tan: a state the body was in rather than a blow it took. The curve cannot be driven off
  // hitFlash, though, because combat decrements that on the frozen clock and hit-stop would hold
  // the flare at full for its whole length — so the rising edge is stamped against `elapsed`,
  // which hit-stop does not touch, and the decay is read off that. Warm rather than white: the
  // skeletons are already pale, and a white flare on a white body deletes the skull it is on.
  // The peak is held near the 0.8 the old flat tint used, which never clipped: what makes the
  // blow read is that it now spikes and falls inside six frames rather than sitting there.
  const rig = enemy.group.userData as { struckAt?: number; wasFlashing?: number };
  if (enemy.hitFlash > (rig.wasFlashing ?? 0)) rig.struckAt = elapsed;
  rig.wasFlashing = enemy.hitFlash;
  const struck = rig.struckAt === undefined ? 0 : Math.max(0, 1 - (elapsed - rig.struckAt) / 0.1) ** 2.2;
  // The tell's second channel. The body already lit during a windup, but at one flat dull brick
  // for the whole of it, which says a blow is coming and never says when — the same fault the
  // arc on the floor had. It takes the threat colour and rides the same clock, so the body is
  // dimmest at the top of the tell and hottest on the frame the blade goes out. That is what
  // makes the tell survive a pier standing between the lens and the arc.
  const closing = enemy.windup > 0 ? 1 - enemy.windup / enemy.tell : 0;
  // Plan 014 round 3 (lever A3): these ran up to 0.7 (struck) and 2.1 (windup) - tuned against
  // a pipeline that was tone-mapping this material before bloom ever saw it. Now that the
  // chain reads real linear HDR (see dungeon-post.ts), an emissive that hot on a whole body
  // mesh - not a point, the entire skeleton - blooms into the shapeless blob a hit used to
  // vanish into. Kept well under the bloom threshold so the flash still reads as a hot tint on
  // the body without becoming a second light source.
  // Plan 014 round 6 (lever 5): round 3's ceiling was tuned against a body standing in the
  // scene's average light, not one standing a torch-light's width from an actual brazier or
  // sconce - and this round's critic still caught both the stalker (mid-windup, torch-room) and
  // a struck skeleton (combat-bridge) clipping to a near-white blob. The emissive term stacks
  // additively on whatever direct light the body already has, so the same absolute ceiling reads
  // as a mild warm cast in mid-room and as a bloom-triggering blowout standing in a torch's own
  // pool. Confirmed with a diagnostic, not a guess: setting this to zero outright on a live
  // capture recovered the stalker's own teal-green bone exactly, at the same frame and the same
  // lighting that had it reading pale pink-white a moment before - so the wash really was this
  // term, and round 3's own halving of it was still an order of magnitude too hot for a body
  // standing this close to a real light source. Cut hard, not halved again: legible as a tint,
  // not a wash, on the frame it peaks.
  enemy.group.traverse((o) => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) { o.material.emissive.setHex(struck > 0 ? COMMIT : enemy.windup > 0 ? THREAT : 0x000000); o.material.emissiveIntensity = struck > 0 ? 0.015 + struck * 0.05 : enemy.windup > 0 ? 0.01 + closing * 0.06 : 0.5; } });
};
