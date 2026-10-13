import { expect, test, press } from './helpers.ts';

// Plan 027 Stage B: how far the poncho's back point stands off its rest place 320 ms into a run, read back off the
// drawn mesh: .0419 (d3d11, 2026-10-12; the hem's lift, .042 back, is most of it). 700 ms after he stops it is
// .0051 off rest, thrown forward by the stop and settling. Plan 028 (smoothed inertia, the hem no longer slammed to
// its clamp on the first frame): .0567 at 320 ms and .0021 at 700 ms after the stop (SwiftShader, 2026-10-12). The
// bound below stays at half of plan 027's reading: it is a floor for "the drawn cloth moved", not a tuning target.
// Plan 030 round 2 (eased hem weight, a livelier spring, SwiftShader, 2026-10-13): .1093 at 320 ms, .0080 at 700 ms after the stop.
const RUN_TIP = 0.0419;

test('travel uses a running rig, freezes on pause, settles on release and yields to attacks and dodge',async({game,page})=>{
  await game.enter();await game.step(120);
  // Plan 027: the poncho's back point as the scene drew it (read back off the mesh after the cloth deform), standing.
  const rest=(await game.state()).player.cloak.tip,away=(tip:number[])=>Math.hypot(...tip.map((v,i)=>v-rest[i]!));
  await page.keyboard.down('ArrowRight');await game.step(320);
  const running=await game.state();
  expect(running.player.locomotion.sprint).toBeGreaterThan(.8);
  console.log(`CLOAK running tip moved ${away(running.player.cloak.tip).toFixed(4)} hem ${running.player.cloak.hem.map(v=>v.toFixed(4)).join(',')} elbow ${running.player.locomotion.elbow.toFixed(3)}`);
  expect(away(running.player.cloak.tip),'the hem moved in the spring but not on the drawn poncho').toBeGreaterThan(RUN_TIP*.5);
  expect(Math.abs(running.player.locomotion.elbow),'the free elbow does not open as he runs').toBeGreaterThan(.3);
  expect(running.player.locomotion.pitch).toBeLessThan(-.2);
  expect(Math.min(...running.player.locomotion.knees)).toBeLessThan(-.2);
  // The tabard swings clear of the leading thigh (plan 013): at a sprint one leg is always at least .14 forward.
  expect(running.player.locomotion.tabard).toBeGreaterThan(.1);
  await game.capture('sprint-extension');
  await game.step(80);await game.capture('sprint-recovery');
  await page.keyboard.press('Escape');const paused=await game.state();await game.step(500);
  expect((await game.state()).player.locomotion).toEqual(paused.player.locomotion);
  await page.keyboard.up('ArrowRight');await page.keyboard.press('Escape');await game.step(700);
  const idle=await game.state();expect(idle.player.locomotion.speed).toBeLessThan(.01);
  console.log(`CLOAK settled tip ${away(idle.player.cloak.tip).toFixed(5)} elbow ${idle.player.locomotion.elbow}`);
  expect(away(idle.player.cloak.tip),'the poncho has not settled 700 ms after he stopped').toBeLessThan(.01);
  expect(Math.abs(idle.player.locomotion.elbow)).toBeLessThan(.01);
  expect(Math.max(...idle.player.locomotion.knees.map(Math.abs))).toBeLessThan(.01);
  expect(Math.abs(idle.player.locomotion.tabard)).toBeLessThan(.01);
  expect(Math.abs(idle.player.locomotion.pitch)).toBeLessThan(.01);
  await page.keyboard.down('ArrowLeft');await game.step(240);
  await press(page, 'attack');await game.step(100);
  const attack=await game.state();expect(attack.player.attackTime).toBeGreaterThan(0);
  expect(attack.player.locomotion.pitch).toBe(0);
  await page.keyboard.up('ArrowLeft');await game.step(400);
  // The dodge has to cut into a stride to show it yields: sampled from a standstill, as this used to be, a
  // stride that ran straight through the dash would pass. Running, dash, and read the gait mid-dash.
  await page.keyboard.down('ArrowLeft');await game.step(320);
  const striding=(await game.state()).player.locomotion.speed;expect(striding).toBeGreaterThan(.5);
  await page.keyboard.press('ShiftLeft');await game.step(80);
  const dodging=await game.state();expect(dodging.player.dashTime).toBeGreaterThan(0);
  expect(dodging.player.locomotion.speed,'the stride kept going through the dash').toBeLessThan(striding*.6);
  await page.keyboard.up('ArrowLeft');await game.step(600);expect((await game.state()).player.locomotion.speed).toBeLessThan(.01);
});

// Holding into a wall stopping the stride is held by footsteps.spec.ts's wall push, which checks the stride
// phase and speed alongside the footfalls it already watched.
