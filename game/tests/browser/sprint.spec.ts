import { expect, test } from './helpers.ts';

test('travel uses a running rig, freezes on pause, settles on release and yields to attacks and dodge',async({game,page})=>{
  await game.enter();await game.step(120);
  await page.keyboard.down('ArrowRight');await game.step(320);
  const running=await game.state();
  expect(running.player.locomotion.sprint).toBeGreaterThan(.8);
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
  expect(Math.max(...idle.player.locomotion.knees.map(Math.abs))).toBeLessThan(.01);
  expect(Math.abs(idle.player.locomotion.tabard)).toBeLessThan(.01);
  expect(Math.abs(idle.player.locomotion.pitch)).toBeLessThan(.01);
  await page.keyboard.down('ArrowLeft');await game.step(240);
  await page.keyboard.press('Space');await game.step(100);
  const attack=await game.state();expect(attack.player.attackTime).toBeGreaterThan(0);
  expect(attack.player.locomotion.pitch).toBe(0);
  await page.keyboard.up('ArrowLeft');await game.step(400);
  await page.keyboard.press('ShiftLeft');await game.step(60);
  expect((await game.state()).player.dashTime).toBeGreaterThan(0);
  await game.step(600);expect((await game.state()).player.locomotion.speed).toBeLessThan(.01);
});

test('holding movement into a wall stops the stride when the knight stops travelling',async({game,page})=>{
  await game.enter();await game.step(120);await page.keyboard.down('ArrowLeft');
  // The starting room is safe. Keep driving into its outer wall until both
  // collision axes have settled, including the initial slide along the wall.
  await game.step(5000);const stopped=await game.state();await game.step(500);
  const held=await game.state();
  expect(Math.hypot(held.player.x-stopped.player.x,held.player.z-stopped.player.z)).toBeLessThan(.001);
  expect(held.player.locomotion.speed).toBeLessThan(.01);
  expect(held.player.locomotion.phase).toBe(stopped.player.locomotion.phase);
  await page.keyboard.up('ArrowLeft');
});
