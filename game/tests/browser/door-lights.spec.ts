import { LIGHT_POOL } from '../../app/dungeon-lights.ts';
import type { Page } from '@playwright/test';
import { canStand, expect, stanceNear, swing, test, TILE, walkUntil, type Floor, type Game, type Snapshot } from './helpers.ts';

// Plan 025 Stage B (D2, D6 amended). Which lights a chamber gets is a node rule (`chamberLights` in
// tests/dungeon-lights.test.ts); this holds that the running game is wired to it, read off what the scene
// placed: the eight pool lights where they hang and what colour they burn, the sconces' painted pools off
// the merged mesh, the doors' labels and sigils off their meshes, the notice off the page and the camera off
// its own focus. One story on one page: a chamber is cleared with a real swing, its doors light up and are
// named, the camera glances at them, the knight walks the chamber end to end under lights that do not move;
// then a second chamber is cleared with reduced motion, where nothing glances and nothing bobs.

/** Plan 017's door tints, which the light over an open door has to wear. */
const TINT: Record<string, number> = { mend: 0xff8a8a, cache: 0xfbc956, rest: 0x71f4c4, stair: 0xe0a150, fight: 0xb9a4ff };
/** What D2 (d) names each reward in the clear notice. */
const NAME: Record<string, string> = { mend: 'Mending', cache: 'Purse' };
type Camera = { focusX: number; focusZ: number };
const cameraOf = (state: Snapshot) => (state as unknown as { camera: Camera }).camera;

const clearWithOneSwing = async (game: Game, page: Page, floor: Floor, opening: Snapshot, room: Floor['rooms'][number]) => {
  const pack = opening.enemies.map((enemy, index) => ({ enemy, index })).filter(({ enemy }) => enemy.room === room.id && !enemy.buried);
  await game.teleport(room.x * TILE, room.z * TILE);
  await game.step(120);
  const stance = stanceNear(floor, { x: room.x * TILE, z: room.z * TILE }, 5, pack.length);
  await game.teleport(stance.x, stance.z);
  await game.step(16);
  await game.configureCombat({ enemies: pack.map(({ index }, i) => ({ index, x: stance.slots[i].x, z: stance.slots[i].z, hp: 1, windup: 0.3, cooldown: 30, aim: { x: -stance.facing.x, z: -stance.facing.z } })) });
  const sealed = await game.state();
  expect(sealed.chamber.id, 'precondition: the knight stands in the chamber to be cleared').toBe(room.id);
  expect(sealed.chamber.sealed, 'precondition: the chamber is sealed before the blow').toBe(true);
  // (The chamber left behind may still be fading its lights out: only this chamber's doors are held dark.)
  expect(sealed.lights.pool.some((light) => light?.kind === 'door' && light.room === room.id), 'a sealed chamber lit its own door').toBe(false);
  await swing(page, stance.key);
  await game.step(120);
  const cleared = await game.state();
  expect(cleared.enemies.filter((enemy) => enemy.room === room.id && !enemy.buried), 'precondition: the blow cleared the chamber').toHaveLength(0);
  expect(cleared.chamber.sealed, 'precondition: the chamber opened').toBe(false);
  if (cleared.boonOffer) await game.takeBoon();
  return cleared;
};

test('a cleared chamber lights and names its doors and glances at them, and its lights hold still while the knight walks it end to end', async ({ game, page }) => {
  test.slow();
  await game.enter();
  const floor = await game.floor();
  const opening = await game.state();
  const bodies = (room: Floor['rooms'][number]) => opening.enemies.filter((enemy) => enemy.room === room.id && !enemy.buried).length;
  const sourcesIn = (id: number) => opening.lights.sources.filter((source) => source.room === id);
  const rewardsBehind = (room: Floor['rooms'][number]) => new Set(floor.doors.filter((door) => door.from === room.id).map((door) => floor.rooms[door.to].reward).filter(Boolean));
  const fights = floor.rooms.filter((room) => room.role === 'path' && room.encounter === 'watch' && bodies(room) >= 1 && bodies(room) <= 3 && floor.doors.some((door) => door.from === room.id));
  // A chamber that offers both rewards and carries more sources than the old pool of eight, so a light chosen by distance would move and plan 026 D4 (every source lit) is tested where it was not true before.
  const room = fights.find((r) => rewardsBehind(r).size === 2 && sourcesIn(r.id).length > 8 && sourcesIn(r.id).some((s) => s.kind === 'brazier') && sourcesIn(r.id).some((s) => s.kind === 'sconce'));
  expect(room, 'the pinned floor has no watch chamber of one to three bodies offering both rewards with more than eight sources: pick another seed').toBeDefined();
  expect(sourcesIn(room!.id).length + floor.doors.filter((door) => door.from === room!.id).length, 'precondition: the chamber fits the pool, as every chamber Stage B counted does').toBeLessThanOrEqual(LIGHT_POOL);
  const second = fights.find((r) => r.id !== room!.id);
  expect(second, 'precondition: a second chamber to clear under reduced motion').toBeDefined();

  const cleared = await clearWithOneSwing(game, page, floor, opening, room!);

  // D2 (d): the notice names both rewards.
  await expect(page.locator('.chamber-notice')).toContainText('Choose your reward');
  for (const reward of rewardsBehind(room!)) await expect(page.locator('.chamber-notice')).toContainText(NAME[reward as string]);

  // D2 (a): every open door has a light over it in its own tint, read off the light.
  const doors = cleared.chamber.doors;
  expect(doors.length, 'precondition: the chamber has ways out').toBeGreaterThanOrEqual(2);
  await game.step(400);
  const lit = await game.state();
  for (const door of lit.chamber.doors) {
    expect(door.open, `door ${door.id} did not open`).toBe(true);
    const light = lit.lights.pool.find((l) => l?.kind === 'door' && Math.hypot(l.x - door.x, l.z - door.z) < 1.5);
    expect(light, `open door ${door.id} (${door.sign}) has no light over it: ${JSON.stringify(lit.lights.pool)}`).toBeDefined();
    expect(light!.on, `the light over door ${door.id} is out`).toBe(true);
    expect(light!.color.toString(16), `the light over door ${door.id} does not wear its ${door.sign} tint`).toBe(TINT[door.sign].toString(16));
    // D2 (b): the sigil at two and a half times, and the reward's name floating over it.
    expect(door.sigil.scale, `door ${door.id}'s sigil is the old size`).toBeCloseTo(2.5, 5);
    expect(door.label, `door ${door.id} has no floating label`).toBe(true);
  }

  // D2 (c): the camera glanced at the open doors and came back.
  const doorsAt = { x: doors.reduce((sum, d) => sum + d.x, 0) / doors.length, z: doors.reduce((sum, d) => sum + d.z, 0) / doors.length };
  const towards = (state: Snapshot) => Math.hypot(cameraOf(state).focusX - doorsAt.x, cameraOf(state).focusZ - doorsAt.z);
  expect(cleared.lights.glance, 'the clear started no glance').not.toBeNull();
  expect(Math.hypot(cleared.lights.glance!.x - doorsAt.x, cleared.lights.glance!.z - doorsAt.z), 'the glance is not at the open doors').toBeLessThan(.01);
  // `lit` was read 0.52 s after the blow, near the glance's height; the knight has not moved since.
  const knightToDoors = Math.hypot(lit.player.x - doorsAt.x, lit.player.z - doorsAt.z);
  console.log(`GLANCE knight->doors ${knightToDoors.toFixed(2)} focus->doors at height ${towards(lit).toFixed(2)}`);
  expect(towards(lit), 'the camera did not ease towards the open doors').toBeLessThan(knightToDoors - 1.5);
  await game.step(1200);
  const back = await game.state();
  expect(back.lights.glance, 'the glance never ended').toBeNull();
  expect(Math.hypot(cameraOf(back).focusX - back.player.x, cameraOf(back).focusZ - back.player.z), 'the camera did not come back to the knight').toBeLessThan(.3);

  // D6: walk the chamber end to end with real keys. The pool's assignment never changes on the way, every brazier
  // keeps a burning light where it stands, and every sconce's painted pool is drawn.
  const tiles = floor.tiles.filter((tile) => tile.room === room!.id).map((tile) => ({ x: tile.x * TILE, z: tile.z * TILE })).filter((p) => canStand(floor.cells, p.x, p.z, .9));
  const from = tiles.reduce((a, b) => (Math.hypot(b.x - room!.x * TILE, b.z - room!.z * TILE) > Math.hypot(a.x - room!.x * TILE, a.z - room!.z * TILE) ? b : a));
  const to = tiles.reduce((a, b) => (Math.hypot(b.x - from.x, b.z - from.z) > Math.hypot(a.x - from.x, a.z - from.z) ? b : a));
  expect(Math.hypot(to.x - from.x, to.z - from.z), 'precondition: the chamber is long enough to walk').toBeGreaterThan(8);
  await game.teleport(from.x, from.z);
  await game.step(400);
  const start = await game.state();
  const assignment = (state: Snapshot) => state.lights.pool.map((light) => light?.id ?? '-').join(' ');
  const braziers = sourcesIn(room!.id).filter((s) => s.kind === 'brazier'), sconces = sourcesIn(room!.id).filter((s) => s.kind === 'sconce');
  let samples = 0;
  const hold = (state: Snapshot) => {
    samples++;
    expect(state.chamber.id, 'the walk left the chamber').toBe(room!.id);
    expect(assignment(state), `the lights moved as the knight walked (at ${state.player.x.toFixed(1)}, ${state.player.z.toFixed(1)})`).toBe(assignment(start));
    expect(state.lights.pool.filter((light) => light !== null && light.room !== room!.id), 'a pool light went to another chamber').toEqual([]);
    for (const b of braziers) expect(state.lights.pool.some((l) => l?.on && Math.hypot(l.x - b.x, l.y - b.y, l.z - b.z) < 1e-3), `the brazier at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) has no light`).toBe(true);
    // Plan 026 D4: every sconce of the chamber burns a real light too, not only the first eight sources.
    for (const s of sconces) expect(state.lights.pool.some((l) => l?.on && Math.hypot(l.x - s.x, l.y - s.y, l.z - s.z) < 1e-3), `the sconce at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) has no light`).toBe(true);
    for (const s of sconces) expect(state.lights.glow!.discs.some((d) => d.drawn && d.room === room!.id && Math.hypot(d.x - s.x, d.z - s.z) < 1e-3), `the sconce at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) paints no pool`).toBe(true);
    expect(state.lights.glow!.discs.filter((d) => d.drawn && d.room !== room!.id), 'another chamber\'s painted pools are drawn').toEqual([]);
    return Math.hypot(state.player.x - to.x, state.player.z - to.z) < 1;
  };
  hold(start);
  expect(await walkUntil(game, page, to, hold, 400), 'the knight never reached the far end of the chamber').toBe(true);
  expect(samples, 'precondition: the walk was sampled on the way').toBeGreaterThan(10);
  const end = await game.state();
  expect(Math.hypot(end.player.x - start.player.x, end.player.z - start.player.z), 'precondition: the knight crossed the chamber').toBeGreaterThan(8);
  // Nothing above linked a shader, and the painted pools draw with a program another material had linked: the post chain pins every
  // program once and each material holds it once more, so a program of the pools' own has two holders and a shared one more.
  expect(end.render.programs, 'the clear, the door lights or the labels compiled a shader').toBe(opening.render.programs);
  expect(end.lights.glow!.programHolders, 'the painted pools linked a shader program of their own').toBeGreaterThan(2);

  // Reduced motion: a second chamber's clear neither glances nor bobs its sigils.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    await expect.poll(async () => ((await game.state()) as unknown as { settings: { reduceMotion: boolean } }).settings.reduceMotion).toBe(true);
    const still = await clearWithOneSwing(game, page, floor, opening, second!);
    expect(still.chamber.doors.length, 'precondition: the second chamber has a way out').toBeGreaterThan(0);
    const ways = still.chamber.doors, at = { x: ways.reduce((sum, d) => sum + d.x, 0) / ways.length, z: ways.reduce((sum, d) => sum + d.z, 0) / ways.length };
    expect(Math.hypot(at.x - still.player.x, at.z - still.player.z), 'precondition: the doors stand far enough off for a glance to show').toBeGreaterThan(3);
    // Read at the same moment the first chamber's glance was at its height.
    await game.step(400);
    const after = await game.state();
    expect(Math.hypot(cameraOf(after).focusX - after.player.x, cameraOf(after).focusZ - after.player.z), 'reduced motion still glanced at the doors').toBeLessThan(.3);
    for (const door of after.chamber.doors) {
      expect(door.sigil.y, `door ${door.id}'s sigil bobs under reduced motion`).toBe(1.25);
      expect(door.sigil.spin, `door ${door.id}'s sigil spins under reduced motion`).toBe(0);
    }
  } finally {
    await page.emulateMedia({ reducedMotion: null });
  }
});
