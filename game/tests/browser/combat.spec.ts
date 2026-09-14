import { swordContacts } from '../../app/dungeon-combat.ts';
import {
  ARROW_KEYS,
  canStand,
  expect,
  hasClearPath,
  keyToward,
  openSpot,
  SCREEN_DIRECTIONS,
  strikeStance,
  test,
  TILE,
  trackEnemy,
  type Floor,
  type Point,
  type ScreenDirection,
  type Snapshot,
} from './helpers.ts';
import type { Page } from '@playwright/test';

/** Melee damage by kind, mirrored from dungeon-game.tsx. */
const MELEE = { guard: 12, stalker: 8, warden: 20 } as const;

const DIRECTIONS = Object.keys(SCREEN_DIRECTIONS) as ScreenDirection[];

/**
 * Spawn indices are what the fixture hook addresses, and they line up with the
 * snapshot only while nothing has died. Every fixture here is staged before the
 * first kill, and this says so out loud instead of hoping.
 */
const spawnIndex = (state: Snapshot, enemy: Snapshot['enemies'][number]) => {
  const index = state.enemies.indexOf(enemy);
  expect(index, 'that enemy is not in this snapshot').toBeGreaterThanOrEqual(0);
  return index;
};

const assertNothingDeadYet = (state: Snapshot, floor: Floor) => {
  expect(
    state.enemies.length,
    'spawn indices only match the snapshot before the first kill',
  ).toBe(floor.spawns.length);
};

const hazardsOf = (state: Snapshot) =>
  state.features.filter((f) => !f.shrine).map((f) => ({ x: f.x, z: f.z }));

/** One real swing, aimed with a real arrow key and not repeated. */
const swing = async (page: Page, key: string) => {
  await page.keyboard.down(key);
  await page.keyboard.down('Space');
  await page.keyboard.up(key);
  await page.keyboard.up('Space');
};

const tilesNear = (floor: Floor, near: Point, radius: number) =>
  floor.tiles
    .map((tile) => ({ x: tile.x * TILE, z: tile.z * TILE }))
    .filter((spot) => Math.hypot(spot.x - near.x, spot.z - near.z) < radius)
    .sort(
      (a, b) =>
        Math.hypot(a.x - near.x, a.z - near.z) -
        Math.hypot(b.x - near.x, b.z - near.z),
    );

/**
 * Somewhere to stand with `count` skeletons abreast inside the arc. They sit
 * 0.9 apart so the crowd-separation pass leaves them alone, and every slot is
 * checked against the production contact rule before anything is moved there.
 */
const packStance = (
  floor: Floor,
  near: Point,
  count: number,
  avoid: Point[],
) => {
  const clear = (spot: Point) =>
    avoid.every((other) => Math.hypot(other.x - spot.x, other.z - spot.z) > 3);
  for (const player of tilesNear(floor, near, 16)) {
    if (!canStand(floor.cells, player.x, player.z) || !clear(player)) continue;
    for (const name of DIRECTIONS) {
      const facing = SCREEN_DIRECTIONS[name];
      const across = { x: -facing.z, z: facing.x };
      const slots: Point[] = [];
      for (let i = 0; i < count; i++) {
        const lateral = (i - (count - 1) / 2) * 0.9;
        const spot = {
          x: player.x + facing.x * 1.05 + across.x * lateral,
          z: player.z + facing.z * 1.05 + across.z * lateral,
        };
        if (!canStand(floor.cells, spot.x, spot.z)) break;
        if (!swordContacts(floor.cells, player, facing, spot, 0)) break;
        if (!clear(spot)) break;
        slots.push(spot);
      }
      if (slots.length === count) {
        return { ...player, facing, slots, key: ARROW_KEYS[name] };
      }
    }
  }
  throw new Error(
    `no stance near (${near.x.toFixed(2)}, ${near.z.toFixed(2)}) fits ${count} skeletons in the arc`,
  );
};

/**
 * A place to stand with one skeleton inside the arc and another squarely behind
 * the knight, close enough for its own melee — the shape the boon-transition
 * race needs.
 */
const duelSpot = (floor: Floor, near: Point, avoid: Point[]) => {
  const clear = (spot: Point) =>
    avoid.every((other) => Math.hypot(other.x - spot.x, other.z - spot.z) > 3);
  for (const player of tilesNear(floor, near, 16)) {
    if (!canStand(floor.cells, player.x, player.z) || !clear(player)) continue;
    for (const name of DIRECTIONS) {
      const facing = SCREEN_DIRECTIONS[name];
      const front = {
        x: player.x + facing.x * 1.05,
        z: player.z + facing.z * 1.05,
      };
      const behind = {
        x: player.x - facing.x * 1.2,
        z: player.z - facing.z * 1.2,
      };
      if (!canStand(floor.cells, front.x, front.z)) continue;
      if (!canStand(floor.cells, behind.x, behind.z)) continue;
      if (!clear(front) || !clear(behind)) continue;
      if (!swordContacts(floor.cells, player, facing, front, 0)) continue;
      // The attacker has to be out of the arc but inside its own reach.
      if (swordContacts(floor.cells, player, facing, behind, 0)) continue;
      if (!hasClearPath(floor.cells, behind, player)) continue;
      return { player, front, behind, facing, key: ARROW_KEYS[name] };
    }
  }
  throw new Error(
    `no duel stance near (${near.x.toFixed(2)}, ${near.z.toFixed(2)})`,
  );
};

test('the sword respects the same walls a skeleton does, and an open lane still lands', async ({
  game,
  page,
}) => {
  await game.enter();
  const floor = await game.floor();
  const opening = await game.state();
  assertNothingDeadYet(opening, floor);

  // A carved prop in a room the generator left empty: the corner can be tested
  // without a crowd wandering through it.
  const quiet = new Set(
    floor.rooms
      .filter((room) => !floor.spawns.some((spawn) => spawn.room === room.id))
      .map((room) => room.id),
  );
  const corner = floor.props
    .filter(
      (prop) => quiet.has(prop.room) && !floor.cells.has(`${prop.x},${prop.z}`),
    )
    .map((prop) => ({
      knight: { x: prop.x * TILE - 1.07, z: prop.z * TILE + 0.25 },
      skeleton: { x: prop.x * TILE - 0.25, z: prop.z * TILE + 1.07 },
    }))
    .find(
      ({ knight, skeleton }) =>
        canStand(floor.cells, knight.x, knight.z) &&
        canStand(floor.cells, skeleton.x, skeleton.z) &&
        !hasClearPath(floor.cells, knight, skeleton),
    );
  expect(
    corner,
    'the pinned floor has no carved prop with a blocked diagonal beside it',
  ).toBeDefined();

  const { knight, skeleton } = corner!;
  const separation = Math.hypot(skeleton.x - knight.x, skeleton.z - knight.z);
  const toward = keyToward({
    x: skeleton.x - knight.x,
    z: skeleton.z - knight.z,
  });
  const facing = SCREEN_DIRECTIONS[toward.name];
  expect(separation).toBeLessThan(1.8);
  expect(
    swordContacts(floor.cells, knight, facing, skeleton, 0),
    'the fixture must be a contact the rule rejects only because of the prop',
  ).toBe(false);

  // Any awake skeleton will do: the wall is on trial, not the kind.
  const victim = opening.enemies.find((enemy) => enemy.awake);
  expect(victim).toBeDefined();
  const index = spawnIndex(opening, victim!);
  const startingHp = victim!.hp;
  // A held windup keeps it still for the whole swing and stops it hitting back,
  // so nothing but the wall can explain a miss.
  const parked = { windup: 0.5, aim: { x: -facing.x, z: -facing.z } };

  await game.teleport(knight.x, knight.z);
  await game.step(16);
  await game.configureCombat({
    enemies: [{ index, x: skeleton.x, z: skeleton.z, ...parked }],
  });
  await swing(page, toward.key);
  await game.step(220);
  const missed = await game.state();
  expect(missed.player.attackTime).toBeGreaterThan(0);
  expect(trackEnemy(missed, victim!.kind, skeleton, 1).hp).toBe(startingHp);
  await game.capture('blocked-corner-contact');
  await game.step(400);

  // Same knight, same separation, an open lane: the swing lands.
  const open = DIRECTIONS.map((name) => ({
    name,
    spot: {
      x: knight.x + SCREEN_DIRECTIONS[name].x * separation,
      z: knight.z + SCREEN_DIRECTIONS[name].z * separation,
    },
  })).find(
    (candidate) =>
      canStand(floor.cells, candidate.spot.x, candidate.spot.z) &&
      swordContacts(
        floor.cells,
        knight,
        SCREEN_DIRECTIONS[candidate.name],
        candidate.spot,
        0,
      ),
  );
  expect(open, 'no open lane of the same length beside the prop').toBeDefined();

  await game.teleport(knight.x, knight.z);
  await game.configureCombat({
    enemies: [{ index, x: open!.spot.x, z: open!.spot.z, ...parked }],
  });
  await swing(page, ARROW_KEYS[open!.name]);
  await game.step(220);
  const landed = await game.state();
  expect(trackEnemy(landed, victim!.kind, open!.spot, 1).hp).toBe(
    startingHp - landed.boons.strike,
  );
});

test('one swing takes exactly one hit off an enemy, however long the blade is on it', async ({
  game,
  page,
}) => {
  await game.enter();
  const floor = await game.floor();
  const opening = await game.state();
  assertNothingDeadYet(opening, floor);
  const warden = opening.enemies.find((enemy) => enemy.kind === 'warden');
  expect(warden).toBeDefined();
  const index = spawnIndex(opening, warden!);

  const spot = openSpot(
    floor,
    { x: warden!.x, z: warden!.z },
    {
      avoid: [
        ...hazardsOf(opening),
        ...opening.enemies
          .filter((enemy) => enemy !== warden)
          .map((enemy) => ({ x: enemy.x, z: enemy.z })),
      ],
      clearance: 5,
    },
  );
  const stance = strikeStance(floor, spot);
  await game.teleport(stance.x, stance.z);
  await game.step(16);
  await game.configureCombat({
    enemies: [
      { index, x: spot.x, z: spot.z, windup: 0.72, aim: { x: 0, z: 1 } },
    ],
  });
  expect(trackEnemy(await game.state(), 'warden', spot, 1).hp).toBe(4);

  // The blade is in contact from 0.065s to 0.175s — seven frames of overlap.
  // 0.38s of swing plus the 0.035s of hitstop a landed blow adds.
  await swing(page, stance.key);
  await game.step(500);
  const after = await game.state();
  expect(after.player.attackTime).toBe(0);
  expect(trackEnemy(after, 'warden', spot, 1).hp).toBe(4 - after.boons.strike);
});

test('two kills in one swing pay out in full even when the first crosses a rank', async ({
  game,
  page,
}) => {
  await game.enter();
  const floor = await game.floor();
  const opening = await game.state();
  assertNothingDeadYet(opening, floor);

  // A dead end: clearing it pays the branch bonus on top of the kills.
  const branch = floor.rooms.find(
    (room) =>
      room.role === 'branch' &&
      opening.enemies.filter((enemy) => enemy.room === room.id).length >= 2 &&
      opening.enemies.filter((enemy) => enemy.room === room.id).length <= 4,
  );
  expect(
    branch,
    'the pinned floor has no dead end holding two to four skeletons',
  ).toBeDefined();
  const pack = opening.enemies.filter((enemy) => enemy.room === branch!.id);
  const indices = pack.map((enemy) => spawnIndex(opening, enemy));

  // Walk in to spring the ambush; asleep skeletons are not eligible targets.
  await game.teleport(branch!.x * TILE, branch!.z * TILE);
  await game.step(120);
  const woken = await game.state();
  expect(
    woken.enemies
      .filter((enemy) => enemy.room === branch!.id)
      .every((enemy) => enemy.awake),
  ).toBe(true);

  const stance = packStance(
    floor,
    { x: branch!.x * TILE, z: branch!.z * TILE },
    pack.length,
    hazardsOf(woken),
  );
  await game.teleport(stance.x, stance.z);
  await game.step(16);
  await game.configureCombat({
    enemies: indices.map((index, i) => ({
      index,
      x: stance.slots[i].x,
      z: stance.slots[i].z,
      hp: 1,
      windup: 0.5,
      aim: { x: -stance.facing.x, z: -stance.facing.z },
    })),
  });

  // The rank crosses on the FIRST of the kills; every later hit in the same
  // swing, and the dead-end bonus behind them, must still be paid out.
  const primed = await game.state();
  const gap = primed.experience.rankCost - primed.experience.intoRank;
  expect(gap).toBeGreaterThan(25);
  await game.grantXp(gap - 25);
  await game.configureCombat({ health: 40 });
  const before = await game.state();
  expect(before.boonOffer).toBe(false);
  expect(before.health).toBe(40);
  expect(
    before.enemies.filter((enemy) => enemy.room === branch!.id).length,
  ).toBe(pack.length);

  await swing(page, stance.key);
  await game.step(220);
  const cleared = await game.state();
  expect(
    cleared.enemies.filter((enemy) => enemy.room === branch!.id).length,
    'a same-swing kill was dropped once the first one crossed the rank',
  ).toBe(0);
  expect(cleared.rank).toBe(before.rank + 1);
  expect(cleared.boonOffer).toBe(true);
  // 25 for each kill, then 60 for emptying the dead end.
  expect(cleared.experience.total - before.experience.total).toBe(
    25 * pack.length + 60,
  );
  expect(cleared.objective.deadEndsPlundered).toBe(
    before.objective.deadEndsPlundered + 1,
  );
  expect(cleared.health).toBe(Math.min(cleared.maxHealth, 40 + 30));
});

test('Salt Ward blunts a sword but the embers of the keep burn through it', async ({
  game,
}) => {
  await game.enter();
  const floor = await game.floor();
  const opening = await game.state();
  assertNothingDeadYet(opening, floor);
  const hazard = opening.features.find((feature) => !feature.shrine);
  expect(hazard, 'the pinned floor has no gauntlet').toBeDefined();

  // Clear the grate of its keepers so the fire is the only thing that can hurt.
  const bolthole = openSpot(floor, { x: 0, z: 0 });
  await game.configureCombat({
    enemies: opening.enemies
      .filter(
        (enemy) => Math.hypot(enemy.x - hazard!.x, enemy.z - hazard!.z) < 30,
      )
      .map((enemy) => ({
        index: spawnIndex(opening, enemy),
        x: bolthole.x,
        z: bolthole.z,
      })),
  });

  const burn = async () => {
    const before = (await game.state()).health;
    for (let tick = 0; tick < 240; tick++) {
      await game.teleport(hazard!.x, hazard!.z);
      await game.step(33);
      const now = (await game.state()).health;
      if (now < before) return before - now;
    }
    throw new Error(`the gauntlet never fired\n${await game.report()}`);
  };

  // Unwarded, the grate costs a flat ten.
  expect((await game.state()).boons.guardAgainst).toBe(1);
  expect(await burn()).toBe(10);

  // Earn Salt Ward. The draft is shuffled, so keep ranking up until it turns up
  // rather than depending on the order the cards happen to land in.
  for (let batch = 0; batch < 3; batch++) {
    await game.grantXp(6000);
    for (let draft = 0; draft < 40; draft++) {
      if (!(await game.state()).boonOffer) break;
      await game.takeBoon();
    }
    if ((await game.state()).boons.guardAgainst < 1) break;
  }
  const warded = await game.state();
  expect(
    warded.boons.guardAgainst,
    'Salt Ward was never offered across three batches of drafts',
  ).toBeLessThan(1);
  expect(warded.boonOffer).toBe(false);

  // The ward softens enemy steel only: the keep's own fire is unwarded, and the
  // boon says so. dungeon-sim's hurt() owns that rule; this checks the running
  // game still routes hazards through it unwarded.
  await game.configureCombat({ health: Math.round(warded.maxHealth / 2) });
  expect(await burn()).toBe(10);
});

test('a boon draft opened mid-swing freezes the world before anything else can land', async ({
  game,
  page,
}) => {
  await game.enter();
  const floor = await game.floor();
  const opening = await game.state();
  assertNothingDeadYet(opening, floor);

  // A companion must survive in the victim's room, or the room-clear heal would
  // paper over exactly the damage this test is looking for.
  const room = floor.rooms.find(
    (candidate) =>
      opening.enemies.filter(
        (enemy) => enemy.room === candidate.id && enemy.awake,
      ).length >= 2,
  );
  expect(
    room,
    'the pinned floor has no room with two awake skeletons',
  ).toBeDefined();
  const crowd = opening.enemies.filter(
    (enemy) => enemy.room === room!.id && enemy.awake,
  );
  const [victim, witness] = crowd;
  // A stalker pounces instead of striking, so the attacker must be neither.
  const attacker = opening.enemies.find(
    (enemy) =>
      enemy !== victim &&
      enemy !== witness &&
      enemy.awake &&
      enemy.kind !== 'stalker',
  );
  expect(
    attacker,
    'the pinned floor has no awake non-stalker attacker to spare',
  ).toBeDefined();

  const stance = duelSpot(floor, { x: victim.x, z: victim.z }, [
    ...hazardsOf(opening),
    { x: witness.x, z: witness.z },
  ]);
  await game.teleport(stance.player.x, stance.player.z);
  await game.step(120);
  // XP 175: the next single kill is worth exactly the 25 that promotes.
  await game.grantXp(175);
  const primed = await game.state();
  expect(primed.experience.rankCost - primed.experience.intoRank).toBe(25);
  expect(primed.boonOffer).toBe(false);

  // Stage the tick. advanceTime(120) runs eight 15ms frames; the blade is in
  // contact from the fifth, and 0.0675s of windup expires on that same fifth
  // frame. One update, both events, in the order the bug needs.
  await game.configureCombat({
    health: 1,
    enemies: [
      {
        index: spawnIndex(opening, victim),
        x: stance.front.x,
        z: stance.front.z,
        hp: 1,
        windup: 0,
      },
      {
        index: spawnIndex(opening, attacker!),
        x: stance.behind.x,
        z: stance.behind.z,
        windup: 0.0675,
        aim: {
          x: stance.player.x - stance.behind.x,
          z: stance.player.z - stance.behind.z,
        },
      },
    ],
  });
  const staged = await game.state();
  expect(staged.health).toBe(1);
  expect(trackEnemy(staged, victim.kind, stance.front, 1).hp).toBe(1);
  expect(
    trackEnemy(staged, attacker!.kind, stance.behind, 1).windup,
  ).toBeCloseTo(0.0675, 6);

  await swing(page, stance.key);
  await game.step(120);

  const frozen = await game.state();
  expect(frozen.boonOffer, 'the killing blow did not promote the knight').toBe(
    true,
  );
  expect(
    frozen.mode,
    'an enemy attack resolved after the draft opened, inside the same update',
  ).toBe('playing');
  expect(frozen.health).toBe(1);
  expect(frozen.rank).toBe(primed.rank + 1);
  await expect(page.locator('.boon-screen')).toBeVisible();
  await game.capture('boon-draft-freeze');

  // Frozen means frozen: the attacker keeps its unfinished windup and its spot.
  const held = trackEnemy(frozen, attacker!.kind, stance.behind, 1);
  expect(held.windup).toBeGreaterThan(0);
  await game.step(3000);
  const later = await game.state();
  expect(later.health).toBe(1);
  expect(later.mode).toBe('playing');
  expect(later.boonOffer).toBe(true);
  const stillHeld = trackEnemy(later, attacker!.kind, stance.behind, 1);
  expect(stillHeld.windup).toBe(held.windup);
  expect(stillHeld.x).toBe(held.x);
  expect(stillHeld.z).toBe(held.z);

  // Choosing resumes the world, and the blow that was held now lands.
  await game.takeBoon(['Grave Draught']);
  const resumed = await game.state();
  expect(resumed.boonOffer).toBe(false);
  expect(resumed.mode).toBe('playing');
  await game.configureCombat({ health: 60 });
  await game.step(120);
  const struck = await game.state();
  expect(struck.health).toBe(
    60 - Math.round(MELEE[attacker!.kind] * resumed.boons.guardAgainst),
  );
});

test('a lethal gauntlet ends the tick: nothing moves after the knight falls', async ({
  game,
}) => {
  await game.enter();
  const floor = await game.floor();
  const opening = await game.state();
  assertNothingDeadYet(opening, floor);
  const hazard = opening.features.find((feature) => !feature.shrine);
  expect(hazard).toBeDefined();
  const witness = opening.enemies.find((enemy) => enemy.awake);
  expect(witness).toBeDefined();
  const index = spawnIndex(opening, witness!);
  // Close enough to be simulated, too far to reach the knight's throat.
  const perch = openSpot(
    floor,
    { x: hazard!.x, z: hazard!.z },
    { radius: 8, avoid: [{ x: hazard!.x, z: hazard!.z }], clearance: 2.6 },
  );

  await game.teleport(hazard!.x, hazard!.z);
  await game.step(16);
  // Ride out the current cycle in one step, then set up on the doorstep of the
  // next flare, with the witness held in a windup so it cannot interfere.
  const phase = (await game.state()).features.find((f) => !f.shrine)!.phase;
  await game.step(((2.5 - phase + 3.6) % 3.6) * 1000);
  await game.teleport(hazard!.x, hazard!.z);
  await game.configureCombat({
    health: 10,
    enemies: [{ index, x: perch.x, z: perch.z, windup: 0.5 }],
  });

  let previous = await game.state();
  expect(previous.health).toBe(10);
  for (let tick = 0; tick < 40; tick++) {
    await game.step(16);
    const now = await game.state();
    const before = trackEnemy(previous, witness!.kind, perch, 1);
    if (now.health === 0) {
      expect(now.mode).toBe('lost');
      const after = trackEnemy(now, witness!.kind, perch, 1);
      // Dead is dead: nothing gets one more move out of the tick that killed.
      expect(after.windup).toBe(before.windup);
      expect(after.x).toBe(before.x);
      expect(after.z).toBe(before.z);
      await game.capture('lethal-gauntlet');
      return;
    }
    expect(
      trackEnemy(now, witness!.kind, perch, 1).windup,
      'the witness should still be winding up while the knight lives',
    ).toBeLessThan(before.windup);
    previous = now;
  }
  throw new Error(`the gauntlet never killed the knight\n${await game.report()}`);
});
