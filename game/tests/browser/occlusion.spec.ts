import { canStand, countChangedPixels, expect, type Floor, type Game, roomCentre, test, TILE } from './helpers.ts';

/**
 * Plan 007: a small camera-facing dithered cutaway in the actual opaque architecture around an actor
 * the fixed isometric camera cannot otherwise see behind.
 *
 * `dungeon-occlusion.test.ts` covers the slot-assignment logic (allocation, fading, clearing) and
 * material registration in isolation. None of that is proof the
 * shader compiles, installs on the real materials, or does anything visible - only an actual WebGL
 * draw and a before/after pixel comparison is, which is what this file is for.
 *
 * One thing this file learned the hard way and bakes in throughout: `cutawayDiagnostics().slots[i]`'s
 * own `strength` is only how far a slot has faded in, not whether any eligible geometry actually sits
 * in its ellipse. The player slot in particular is always 1 while playing (the plan's own "remains at
 * full strength" rule), so it can never be used to tell an occluded spot from a clear one - only an
 * actual rendered pixel difference can. The diagnostic stays useful for what it does answer: which
 * slots exist, whose id they hold, and how many are allocated at once.
 *
 * Finding a position the camera actually can't see past costs real draws and is the expensive part of
 * this file, not the assertions that follow it - so the main scenario below finds one occluded and one
 * clear spot exactly once and reuses both for every question that needs them (a zero-time redraw, a
 * pause, moving away, a floor rebuild), rather than re-searching per question.
 */

/** What every scene gets before its first frame: torches lit, water moving, camera caught up. */
const SETTLE = 640;

/**
 * The camera is fixed and orthographic - focus + (9.2, 12.5, 11.5), aimed at the focus (dungeon-art.ts).
 * Two world points project to the same screen position exactly when their difference is parallel to
 * this vector, which is what lets a position be placed deliberately "behind" a tall occluder rather
 * than found by trial and error against a screenshot.
 */
const CAMERA_OFFSET = { x: 9.2, y: 12.5, z: 11.5 };

/**
 * Sweeps a small range of camera-ray offsets from `occluder` (toward the camera, so the occluder ends
 * up between the camera and the returned spot) and keeps whichever are legal to stand on. A short
 * sweep, not one exact number: the offset also has to clear the occluder's own footprint (a pillar is
 * not a point), and the exact ratio that keeps a fragment's world-y inside the cutaway's own gap
 * window (0.10 to 6.0 world units) depends on the occluder's actual height, which this test does not
 * recompute from the generator's own random draws (see dungeon-art.ts's `headroom` comments on why a
 * pillar with generous headroom is tall regardless of its random roll).
 */
const behindSpots = (occluder: { x: number; z: number }, floor: Floor) => {
  const spots: { x: number; z: number }[] = [];
  for (const u of [0.16, 0.2, 0.24, 0.28, 0.32, 0.36, 0.4]) {
    const spot = { x: occluder.x - CAMERA_OFFSET.x * u, z: occluder.z - CAMERA_OFFSET.z * u };
    if (canStand(floor.cells, spot.x, spot.z)) spots.push(spot);
  }
  return spots;
};

/** Every tile with at least one open (non-floor) neighbour: where the game's own near/far wall and
 * buttress masonry actually stands, per `addAtmosphere`'s and `addCarvedArchitecture`'s own perimeter
 * loops. Used only to generate camera-ray candidates for the live search below - never to assert a
 * specific batch exists, which the pixel comparison after placement settles does instead. */
const perimeterTiles = (floor: Floor) => {
  const solid = new Set(floor.tiles.map((t) => `${t.x},${t.z}`));
  return floor.tiles.filter((t) => !t.wood && ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dz]) => !solid.has(`${t.x + dx},${t.z + dz}`)));
};

/** Pillars first: there are only ever a handful, and (unlike a perimeter tile, where placement is
 * gated and probabilistic - see `addAtmosphere`) every one is real, tall, standing geometry. The
 * perimeter list is capped rather than exhausted; it exists as a fallback for the rare floor with no
 * pillar at all, not as the primary source. */
const occluderCandidates = (floor: Floor) => [
  ...floor.props.filter((p) => p.kind === 'pillar').map((p) => ({ x: p.x * TILE, z: p.z * TILE })),
  ...perimeterTiles(floor).slice(0, 24).map((t) => ({ x: t.x * TILE, z: t.z * TILE })),
].flatMap((occluder) => behindSpots(occluder, floor));

/**
 * Finds a player position that actually, visibly opens a window - not one the diagnostic merely
 * *could* fade in for (see the file header): teleports to each candidate, draws the same instant with
 * the cutaway disabled and enabled, and keeps the first spot where real pixels differ.
 */
const findOccludedPlayerSpot = async (game: Game, floor: Floor) => {
  const candidates = occluderCandidates(floor);
  for (const spot of candidates) {
    await game.teleport(spot.x, spot.z);
    await game.step(SETTLE);
    const frames = await game.cutawayFrames();
    const changed = countChangedPixels(frames.off, frames.on);
    if (changed > 0) return { spot, frames, changed };
  }
  throw new Error(`none of ${candidates.length} candidate spots produced a visible cutaway`);
};

/**
 * A room centre is where existing near architecture is deliberately height-limited to stay clear of a
 * *centre-standing* actor (see `headroom`'s own comments in dungeon-art.ts) - it is not a guarantee
 * against every structure on the floor, including a neighbouring room's own tall backdrop mass. So
 * this searches live too: the first room centre that draws pixel-identical with the cutaway disabled
 * and enabled.
 */
const findClearPlayerSpot = async (game: Game, floor: Floor) => {
  for (const room of floor.rooms) {
    const centre = roomCentre(floor, room.id);
    if (!canStand(floor.cells, centre.x, centre.z)) continue;
    await game.teleport(centre.x, centre.z);
    await game.step(SETTLE);
    const frames = await game.cutawayFrames();
    if (countChangedPixels(frames.off, frames.on) === 0) return { spot: centre, frames };
  }
  throw new Error('no room centre in this floor draws pixel-identical with the cutaway disabled and enabled');
};

test.describe('local actor cutaway', () => {
  test.use({ seeds: [0x1] });

  /**
   * One consolidated scenario rather than one test per question: an occluded spot and a clear spot
   * are each genuinely expensive to find (a live search over real draws), and every question below -
   * a zero-time redraw, a pause, moving away, a floor rebuild - is cheap once both are already in
   * hand. Splitting them into separate tests would re-run the same two searches once per question for
   * no additional coverage, which is exactly the CI-budget mistake this plan's own notes warn against.
   */
  test('an occluded actor reveals a real hole, an unobstructed control does not, and both hold up under a redraw, a pause, moving away and a floor rebuild', async ({ game }) => {
    // The live occluded/clear-spot search below draws real frames per candidate under SwiftShader;
    // a local run already took ~3.9 minutes at the previous 240s ceiling, which a CI shard under
    // 2-worker CPU contention pushed past that budget with no logic fault (a plain timeout, not the
    // search's own "no candidate produced a visible cutaway" error). More headroom, not a redesign.
    test.setTimeout(420_000);
    await game.enter();
    const floor = await game.floor();

    const occluded = await findOccludedPlayerSpot(game, floor);
    expect(occluded.changed, 'enabling the cutaway over an actually-occluded player must change some pixels').toBeGreaterThan(0);
    // A hole, not the whole wall: bounded by the ellipse and the frame it stands in, not a fifth of
    // the canvas. Loose on purpose - a sanity ceiling against "the whole wall vanished" or "the whole
    // screen changed", not a tight regression bound on the exact opening size.
    const share = occluded.changed / (occluded.frames.off.length / 4);
    expect(share, `the cutaway changed ${(share * 100).toFixed(1)}% of the frame - a small local window, not a wall-sized hole`).toBeLessThan(0.08);
    await game.capture('occlusion-player-occluded-on');

    const clear = await findClearPlayerSpot(game, floor);
    expect(countChangedPixels(clear.frames.off, clear.frames.on), 'a clear-control scene must be pixel-identical with the feature enabled or disabled').toBe(0);
    await game.capture('occlusion-player-control');

    // Back at the occluded spot: a zero-time redraw must leave the rendered pixels exactly where they
    // were, and so must a pause - both read as a single synchronous task (`pauseFreezeCheck`), because
    // driving the pause action and the read that follows it as two separate round trips occasionally
    // let this test observe a transient frame from the real browser's own paint scheduling in the gap
    // between them: a harness race, not a simulation bug, and one only a single task can rule out.
    await game.teleport(occluded.spot.x, occluded.spot.z);
    await game.step(SETTLE);
    const before = await game.framePixels();
    const afterZero = await game.framePixels();
    expect(countChangedPixels(before, afterZero), 'a zero-time redraw of an unchanged instant must be pixel-identical').toBe(0);
    const paused = await game.pauseFreezeCheck(500); // paused: the whole update() function returns before this ever runs
    expect(countChangedPixels(paused.before, paused.after), 'pause freezes the rendered cutaway exactly like every other simulated thing').toBe(0);

    // Moving away closes it; stepping back in reopens it.
    await game.teleport(clear.spot.x, clear.spot.z);
    await game.step(SETTLE);
    const away = await game.cutawayFrames();
    expect(countChangedPixels(away.off, away.on), 'moving away closes the effect').toBe(0);
    await game.teleport(occluded.spot.x, occluded.spot.z);
    await game.step(SETTLE);
    const reopened = await game.cutawayFrames();
    expect(countChangedPixels(reopened.off, reopened.on), 'stepping back into the window reopens it').toBeGreaterThan(0);

    // The new floor registers its own occluders. (Whether a rebuild can carry a stale enemy slot over is
    // asked in the enemy test below, where an enemy actually holds one when the floor goes.)
    await game.buildFloor(2);
    await game.built();
    await game.step(SETTLE);
    expect((await game.cutawayDiagnostics()).registeredMeshCount, 'the new floor registers its own eligible meshes').toBeGreaterThan(0);
  });

  // The game decides which bodies are candidates at all (awake, in the knight's room, within
  // CUTAWAY_ENEMY_RANGE, attacking) in its own frame loop; the controller then caps and fades them
  // (tests/dungeon-occlusion.test.ts). Both earlier versions of this never reached that filter: one stood
  // the knight in the enemy-free gate room, so every count was 0, and the other skipped on every run. A
  // pinned seed has to stage this, so a missing fixture fails rather than skips.
  test('only attacking bodies in the knight\'s room and in range hold a slot, never more than two, and the pixels open for one', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    const state = await game.state();
    const enemySlots = async () => (await game.cutawayDiagnostics()).slots.filter((s) => s.owner !== null && s.owner !== 'player');
    const byRoom = new Map<number, number[]>();
    state.enemies.forEach((e, i) => { if (e.awake) byRoom.set(e.room, [...(byRoom.get(e.room) ?? []), i]); });
    const [room, members] = [...byRoom].find(([, list]) => list.length >= 3) ?? [undefined, []];
    expect(room, 'the pinned seed no longer holds a room with three awake enemies; pick another fixture seed').toBeDefined();
    const outsider = state.enemies.findIndex((e) => e.awake && e.room !== room);
    expect(outsider, 'the pinned seed holds no awake enemy outside that room').toBeGreaterThanOrEqual(0);

    // Calm every body before the knight walks in: the room's own would otherwise notice him during the
    // settle and wind up, and a slot fades out over several frames after its windup stops.
    const calm = state.enemies.map((e, index) => ({ index, hp: e.hp, windup: 0, cooldown: 999 }));
    await game.configureCombat({ health: state.maxHealth, enemies: calm });
    const centre = roomCentre(floor, room!);
    await game.teleport(centre.x, centre.z);
    await game.step(SETTLE);
    expect((await enemySlots()).length, 'a calm room already holds an enemy slot').toBe(0);
    const beside = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ x: centre.x + Math.cos(k * Math.PI / 4) * 1.8, z: centre.z + Math.sin(k * Math.PI / 4) * 1.8 }))
      .filter((p) => canStand(floor.cells, p.x, p.z));
    expect(beside.length, 'too little floor around the room centre to stand three attackers').toBeGreaterThanOrEqual(3);

    // A body from another room, winding up right beside the knight: the room filter alone keeps it out.
    await game.configureCombat({ enemies: [...calm.filter((e) => e.index !== outsider), { index: outsider, x: beside[0].x, z: beside[0].z, hp: state.enemies[outsider].hp, windup: 0.5, cooldown: 999 }] });
    await game.step(150);
    expect((await enemySlots()).length, 'an attacking body from a neighbouring room took a slot').toBe(0);

    // Three of the room's own, all attacking within range: exactly the two-slot cap, and the player keeps his.
    await game.configureCombat({ enemies: [...calm.filter((e) => !members.slice(0, 3).includes(e.index)), ...members.slice(0, 3).map((index, k) => ({ index, x: beside[k].x, z: beside[k].z, hp: state.enemies[index].hp, windup: 0.5, cooldown: 999 }))] });
    await game.step(150);
    expect((await enemySlots()).length, 'three attackers in range should fill exactly the two enemy slots').toBe(2);
    expect((await game.cutawayDiagnostics()).slots.filter((s) => s.owner === 'player').length, 'the player keeps its own slot').toBe(1);

    // The pixels: one attacker behind an occluder in this room, the knight walked to within range of it
    // (toward the room centre, staying in the room). A spot counts only if the same frame with the body
    // calm is pixel-identical, so the window is the enemy's and not the knight's own.
    const inRoom = (p: { x: number; z: number }) => floor.tiles.some((t) => t.room === room && t.x === Math.round(p.x / TILE) && t.z === Math.round(p.z / TILE));
    const candidates = [
      ...floor.props.filter((p) => p.kind === 'pillar' && p.room === room).map((p) => ({ x: p.x * TILE, z: p.z * TILE })),
      ...perimeterTiles(floor).filter((t) => t.room === room).map((t) => ({ x: t.x * TILE, z: t.z * TILE })),
    ].flatMap((o) => behindSpots(o, floor)).filter(inRoom);
    let opened = 0, tried = 0;
    for (const spot of candidates) {
      if (tried >= 16) break;
      const toCentre = Math.hypot(centre.x - spot.x, centre.z - spot.z) || 1, reach = Math.min(2.5, toCentre);
      const stand = { x: spot.x + (centre.x - spot.x) / toCentre * reach, z: spot.z + (centre.z - spot.z) / toCentre * reach };
      if (!canStand(floor.cells, stand.x, stand.z) || !inRoom(stand)) continue;
      tried++;
      await game.configureCombat({ enemies: [...calm.filter((e) => e.index !== members[0]), { index: members[0], x: spot.x, z: spot.z, hp: state.enemies[members[0]].hp, windup: 0, cooldown: 999 }] });
      await game.teleport(stand.x, stand.z);
      await game.step(300);
      const alone = await game.cutawayFrames();
      if (countChangedPixels(alone.off, alone.on) > 0) continue;
      await game.configureCombat({ enemies: [{ index: members[0], windup: 0.5, cooldown: 999 }] });
      await game.step(150);
      const frames = await game.cutawayFrames();
      opened = countChangedPixels(frames.off, frames.on);
      if (opened > 0) break;
    }
    expect(opened, `none of ${tried} occluded spots in range opened a window for an attacking enemy`).toBeGreaterThan(0);
    await game.teleport(centre.x, centre.z);
    await game.capture('occlusion-enemy-windup-behind-wall');

    // Out of the windup, every body lets its slot go.
    await game.configureCombat({ enemies: calm });
    await game.step(300);
    expect((await enemySlots()).length, 'an idle body (no windup, no release) must never hold a slot').toBe(0);

    // A rebuild while an enemy holds a slot must not carry its id into the new floor's enemies.
    await game.configureCombat({ enemies: [...calm.filter((e) => e.index !== members[0]), { index: members[0], x: beside[0].x, z: beside[0].z, hp: state.enemies[members[0]].hp, windup: 0.5, cooldown: 999 }] });
    await game.step(150);
    expect((await enemySlots()).length, 'the fixture needs an enemy holding a slot when the floor goes').toBe(1);
    await game.buildFloor(2);
    await game.built();
    await game.step(SETTLE);
    expect((await enemySlots()).length, 'a floor rebuild carried a stale enemy slot into the new floor').toBe(0);
  });
});

// Nightly: the cutaway's projection is covered at desktop aspect on every pull request; this repeats it at a
// phone's, which costs a page of its own and a full occluder search.
test.describe('local actor cutaway on a phone', { tag: '@nightly' }, () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, seeds: [0x1] });

  test('an occluded player still opens a window at phone size and aspect', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    const { changed, frames } = await findOccludedPlayerSpot(game, floor);
    expect(changed, 'a camera-aspect change must not break the effect').toBeGreaterThan(0);
    // The same ceiling as the desktop case: a projection gone wrong at this aspect opens a wall, not a window.
    expect(changed / (frames.off.length / 4), 'the cutaway opened far more than a local window at phone aspect').toBeLessThan(0.08);
    await game.capture('occlusion-mobile-player-occluded');
  });
});
