import {
  expect,
  Game,
  keyToward,
  laneSpot,
  SCREEN_DIRECTIONS,
  speedOf,
  strikeStance,
  test,
  TILE,
  trackEnemy,
  type Point,
  type Snapshot,
} from './helpers.ts';

type Enemy = Snapshot['enemies'][number];

const track = (state: Snapshot, kind: Enemy['kind'], near: Point) =>
  trackEnemy(state, kind, near);

/** An awake enemy of a kind that no hazard or second skeleton crowds. */
const isolated = (state: Snapshot, kind: Enemy['kind']) => {
  const hazards = state.features
    .filter((feature) => !feature.shrine)
    .map((feature) => ({ x: feature.x, z: feature.z }));
  const found = state.enemies.find(
    (enemy) =>
      enemy.kind === kind &&
      enemy.awake &&
      hazards.every(
        (hazard) => Math.hypot(hazard.x - enemy.x, hazard.z - enemy.z) > 8,
      ) &&
      state.enemies.every(
        (other) =>
          other === enemy ||
          !other.awake ||
          Math.hypot(other.x - enemy.x, other.z - enemy.z) > 6,
      ),
  );
  expect(
    found,
    `the pinned floor has no isolated, hazard-free ${kind}`,
  ).toBeDefined();
  return found!;
};

/** Walks time forward until the tracked enemy commits, or fails loudly. */
const waitForWindup = async (game: Game, kind: Enemy['kind'], anchor: Point) => {
  for (let attempt = 0; attempt < 240; attempt++) {
    const state = await game.state();
    const enemy = track(state, kind, anchor);
    if (enemy.windup > 0) return { state, enemy };
    await game.step(16);
  }
  throw new Error(
    `the ${kind} never committed to an attack\n${await game.report()}`,
  );
};

test('keyboard movement is screen-relative, release stops it, and a stationary dash carries the knight', async ({
  game,
  page,
}) => {
  await game.enter();
  const start = await game.state();

  await page.keyboard.down('ArrowRight');
  await game.step(200);
  const moving = await game.state();
  const speed = speedOf(moving);
  expect(speed).toBeGreaterThan(8);
  // Right on the keyboard means right on the screen, not +X in the world.
  const heading = {
    x: moving.player.velocity.x / speed,
    z: moving.player.velocity.z / speed,
  };
  expect(
    heading.x * SCREEN_DIRECTIONS.right.x +
      heading.z * SCREEN_DIRECTIONS.right.z,
  ).toBeCloseTo(1, 3);
  const travel = {
    x: moving.player.x - start.player.x,
    z: moving.player.z - start.player.z,
  };
  const distance = Math.hypot(travel.x, travel.z);
  expect(distance).toBeGreaterThan(1);
  expect(
    (travel.x * SCREEN_DIRECTIONS.right.x +
      travel.z * SCREEN_DIRECTIONS.right.z) /
      distance,
  ).toBeCloseTo(1, 2);

  await page.keyboard.up('ArrowRight');
  await game.step(60);
  const released = await game.state();
  expect(speedOf(released)).toBe(0);
  await game.step(600);
  const settled = await game.state();
  expect(settled.player.x).toBeCloseTo(released.player.x, 6);
  expect(settled.player.z).toBeCloseTo(released.player.z, 6);

  await page.keyboard.press('ShiftLeft');
  expect((await game.state()).player.dashTime).toBeGreaterThan(0);
  await game.step(30);
  expect(speedOf(await game.state())).toBeGreaterThan(11);
  await game.step(400);
  const dashed = await game.state();
  expect(dashed.player.dashTime).toBe(0);
  expect(dashed.player.dashCooldown).toBeGreaterThan(0);
  // A dash from standing still travels along the facing the knight already had.
  expect(
    (dashed.player.x - settled.player.x) * SCREEN_DIRECTIONS.right.x +
      (dashed.player.z - settled.player.z) * SCREEN_DIRECTIONS.right.z,
  ).toBeGreaterThan(1.2);
});

test('held Space repeats strikes and every swing takes real health off a warden', async ({
  game,
  page,
}) => {
  await game.enter();
  const floor = await game.floor();
  const opening = await game.state();
  const warden = opening.enemies.find((enemy) => enemy.kind === 'warden');
  expect(warden, 'the pinned floor lost its stair wardens').toBeDefined();
  const anchor = { x: warden!.x, z: warden!.z };
  const stance = strikeStance(floor, anchor);

  await game.teleport(stance.x, stance.z);
  await game.step(16);
  // Vitality is quoted in quarter-hits of a starting blade, so a floor-one warden
  // is four blows however hard the held weapon happens to hit.
  const armed = await game.state();
  const blade = armed.weapon.strikeDamage;
  expect(track(armed, 'warden', anchor).hp).toBe(4 * blade);

  // Latch the facing with a real arrow key, then hold only Space so the knight
  // stays put and the repeat comes from the held strike, not from walking in.
  await page.keyboard.down(stance.key);
  await page.keyboard.down('Space');
  await page.keyboard.up(stance.key);

  await game.step(120);
  expect((await game.state()).player.attackTime).toBeGreaterThan(0);
  await game.step(120);
  expect(track(await game.state(), 'warden', anchor).hp).toBe(3 * blade);

  // A swing lasts 0.38s; crossing that boundary with Space held starts another.
  await game.step(400);
  const second = await game.state();
  expect(track(second, 'warden', anchor).hp).toBe(2 * blade);
  expect(second.player.attackTime).toBeGreaterThan(0);

  await page.keyboard.up('Space');
  await game.step(600);
  const stopped = await game.state();
  expect(stopped.player.attackTime).toBe(0);
  expect(stopped.player.attackBuffer).toBe(0);
  expect(track(stopped, 'warden', anchor).hp).toBe(2 * blade);
});

test('pause and the expanded map freeze the world, and losing focus drops held input', async ({
  game,
  page,
}) => {
  await game.enter();
  const floor = await game.floor();
  const opening = await game.state();
  const guard = isolated(opening, 'guard');
  const spot = laneSpot(
    floor,
    { x: guard.x, z: guard.z },
    3.2,
    { avoid: opening.features.map((f) => ({ x: f.x, z: f.z })) },
  );
  await game.teleport(spot.x, spot.z);
  await game.step(200);

  const world = (state: Snapshot) =>
    JSON.stringify({ player: state.player, enemies: state.enemies });

  await page.keyboard.press('Escape');
  const paused = await game.state();
  expect(paused.mode).toBe('paused');
  await game.step(2500);
  expect(world(await game.state())).toBe(world(paused));
  await page.locator('.intro-screen .primary-action').click();
  expect((await game.state()).mode).toBe('playing');

  await page.getByRole('button', { name: 'Open floor map' }).click();
  await expect(page.locator('.map-screen')).toBeVisible();
  const mapped = await game.state();
  expect(mapped.mode).toBe('paused');
  await game.step(2500);
  expect(world(await game.state())).toBe(world(mapped));
  await page.locator('.map-screen .primary-action').click();
  await expect(page.locator('.map-screen')).toBeHidden();
  expect((await game.state()).mode).toBe('playing');

  await page.keyboard.down('ArrowLeft');
  await game.step(80);
  expect(speedOf(await game.state())).toBeGreaterThan(0);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  // Current behaviour: losing focus clears input and requires a manual resume.
  expect((await game.state()).mode).toBe('paused');
  await page.keyboard.up('ArrowLeft');
  await page.locator('.intro-screen .primary-action').click();
  const resumed = await game.state();
  expect(resumed.mode).toBe('playing');
  await game.step(300);
  const after = await game.state();
  expect(speedOf(after)).toBe(0);
  expect(after.player.x).toBeCloseTo(resumed.player.x, 6);
  expect(after.player.z).toBeCloseTo(resumed.player.z, 6);
});

test.describe('committed enemy attacks', () => {
  test('a committed stalker hits a stationary knight', async ({ game }) => {
    await game.enter();
    const floor = await game.floor();
    const opening = await game.state();
    const stalker = isolated(opening, 'stalker');
    const anchor = { x: stalker.x, z: stalker.z };
    const spot = laneSpot(floor, anchor, 2.7, {
      avoid: opening.features.map((f) => ({ x: f.x, z: f.z })),
      clearance: 4,
    });

    await game.teleport(spot.x, spot.z);
    await game.step(16);
    const before = (await game.state()).health;
    const { enemy } = await waitForWindup(game, 'stalker', anchor);
    await game.capture('stalker-committed');
    await game.step(enemy.windup * 1000 + 500);
    expect((await game.state()).health).toBeLessThan(before);
  });

  test('a sideways dash evades the same committed pounce', async ({
    game,
    page,
  }) => {
    await game.enter();
    const floor = await game.floor();
    const opening = await game.state();
    const stalker = isolated(opening, 'stalker');
    const anchor = { x: stalker.x, z: stalker.z };
    const spot = laneSpot(floor, anchor, 2.7, {
      avoid: opening.features.map((f) => ({ x: f.x, z: f.z })),
      clearance: 4,
    });

    await game.teleport(spot.x, spot.z);
    await game.step(16);
    const { state, enemy } = await waitForWindup(game, 'stalker', anchor);
    const before = state.health;
    // The pounce keeps the aim it locked in, so leaving that line is the dodge.
    const escape = [
      { x: -enemy.aim.z, z: enemy.aim.x },
      { x: enemy.aim.z, z: -enemy.aim.x },
    ].find((direction) =>
      floor.cells.has(
        `${Math.round((state.player.x + direction.x * 2.4) / TILE)},${Math.round(
          (state.player.z + direction.z * 2.4) / TILE,
        )}`,
      ),
    );
    expect(
      escape,
      'no walkable ground on either side of the pounce line',
    ).toBeDefined();
    const key = keyToward(escape!).key;

    await game.step(Math.max(0, enemy.windup * 1000 - 70));
    await page.keyboard.down(key);
    await game.act('dash');
    await game.step(200);
    await page.keyboard.up(key);
    await game.step(500);
    expect((await game.state()).health).toBe(before);
  });

  test('a warden reaches past the range a guard can strike from', async ({
    game,
  }) => {
    await game.enter();
    const floor = await game.floor();
    const opening = await game.state();
    const warden = opening.enemies.find((enemy) => enemy.kind === 'warden');
    expect(warden).toBeDefined();
    const anchor = { x: warden!.x, z: warden!.z };
    // 2.1 is outside a guard's 1.15 attack distance and inside a warden's 2.2.
    const spot = laneSpot(floor, anchor, 2.1, {
      avoid: [
        ...opening.features.map((f) => ({ x: f.x, z: f.z })),
        ...opening.enemies
          .filter((enemy) => enemy !== warden)
          .map((enemy) => ({ x: enemy.x, z: enemy.z })),
      ],
      clearance: 3,
    });

    await game.teleport(spot.x, spot.z);
    await game.step(16);
    const before = (await game.state()).health;
    const { enemy } = await waitForWindup(game, 'warden', anchor);
    await game.capture('warden-committed');
    await game.step(enemy.windup * 1000 + 120);
    const after = await game.state();
    expect(before - after.health).toBe(20);
  });
});

test('a gauntlet burns on its flare, a dash rides it out, and a shrine heals exactly once', async ({
  game,
}) => {
  await game.enter();
  const opening = await game.state();
  const hazard = opening.features.find((feature) => !feature.shrine);
  const shrine = opening.features.find((feature) => feature.shrine);
  expect(hazard, 'the pinned floor has no gauntlet').toBeDefined();
  expect(shrine, 'the pinned floor has no shrine').toBeDefined();
  const liveHazard = async () =>
    (await game.state()).features.find((feature) => !feature.shrine)!;
  const liveShrine = async () =>
    (await game.state()).features.find((feature) => feature.shrine)!;

  // A shrine at full vitality stays lit: it heals, it is not a pickup.
  await game.teleport(shrine!.x, shrine!.z);
  await game.step(400);
  const untouched = await game.state();
  expect(untouched.health).toBe(untouched.maxHealth);
  expect((await liveShrine()).used).toBe(false);

  // The gauntlet cycles every 3.6s and burns through the last second of it.
  await game.teleport(hazard!.x, hazard!.z);
  await game.step(16);
  const wholeHealth = (await game.state()).health;
  let burned = wholeHealth;
  for (let tick = 0; tick < 200 && burned === wholeHealth; tick++) {
    await game.step(33);
    burned = (await game.state()).health;
  }
  expect(burned, 'the gauntlet never burned the knight').toBeLessThan(
    wholeHealth,
  );
  await game.capture('gauntlet-flare');

  // Dash immunity. Wait out this flare, then meet the next one mid-dash: the
  // hurt cooldown is 0.65s and the gap between flares is 2.6s, so nothing else
  // can explain the knight walking away clean.
  for (let tick = 0; tick < 200 && (await liveHazard()).phase > 2.6; tick++) {
    await game.step(33);
  }
  const gap = (await liveHazard()).phase;
  await game.step(Math.max(0, (2.6 - gap) * 1000 - 60));
  const guarded = (await game.state()).health;
  await game.act('dash');
  let flaredDuringDash = false;
  for (let tick = 0; tick < 12; tick++) {
    await game.teleport(hazard!.x, hazard!.z);
    await game.step(30);
    const state = await game.state();
    if (state.player.dashTime <= 0) break;
    flaredDuringDash ||= state.features.find((f) => !f.shrine)!.phase > 2.6;
    expect(state.health, 'a dash must ignore the flare').toBe(guarded);
  }
  expect(
    flaredDuringDash,
    'the gauntlet never fired while the dash was active',
  ).toBe(true);
  // And the very same spot still burns once the dash ends.
  let afterDash = guarded;
  for (let tick = 0; tick < 40 && afterDash === guarded; tick++) {
    await game.teleport(hazard!.x, hazard!.z);
    await game.step(33);
    afterDash = (await game.state()).health;
  }
  expect(afterDash).toBeLessThan(guarded);

  // The shrine room holds no spawns, so the heal can be measured exactly.
  await game.teleport(shrine!.x, shrine!.z);
  await game.step(200);
  const healed = await game.state();
  expect((await liveShrine()).used).toBe(true);
  expect(healed.health).toBe(Math.min(healed.maxHealth, afterDash + 35));
  await game.capture('shrine-spent');

  // Spent is spent: walking back on after fresh damage heals nothing.
  await game.teleport(hazard!.x, hazard!.z);
  let hurtAgain = healed.health;
  for (let tick = 0; tick < 200 && hurtAgain === healed.health; tick++) {
    await game.step(33);
    hurtAgain = (await game.state()).health;
  }
  expect(hurtAgain).toBeLessThan(healed.health);
  await game.teleport(shrine!.x, shrine!.z);
  await game.step(600);
  expect((await game.state()).health).toBe(hurtAgain);
});

test.describe('touch controls', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    // The labelled direction buttons are the alternative touch layout; the
    // default thumbstick has its own coverage in polish.spec.ts. Settings are
    // read from localStorage on mount, and a partial blob keeps every default
    // it does not name.
    storageState: {
      cookies: [],
      origins: [
        {
          // The same port the config resolves, or the blob is filed under an
          // origin the page never visits and the pad layout never mounts.
          origin: `http://127.0.0.1:${process.env.GAME_TEST_PORT ?? 3000}`,
          localStorage: [
            {
              name: 'drowned-keep:settings',
              value: JSON.stringify({ touchLayout: 'pad' }),
            },
          ],
        },
      ],
    },
  });

  test('a held strike repeats, release and cancel stop it, and the knight can move mid-swing', async ({
    game,
  }) => {
    await game.enter();
    const floor = await game.floor();
    const opening = await game.state();
    const warden = opening.enemies.find((enemy) => enemy.kind === 'warden');
    expect(warden).toBeDefined();
    const anchor = { x: warden!.x, z: warden!.z };
    const stance = strikeStance(floor, anchor, { distance: 1.6 });
    await game.teleport(stance.x, stance.z);
    await game.step(16);
    const armed = await game.state();
    const blade = armed.weapon.strikeDamage;
    expect(track(armed, 'warden', anchor).hp).toBe(4 * blade);

    const strike = await game.centreOf('.touch-actions .strike');
    const pad = await game.centreOf(`.touch-pad .${stance.direction}`);

    // A thumb on the pad aims the knight; the facing survives the release, the
    // same way a keyboard player turns before committing to a swing.
    await game.touch('touchStart', [{ ...pad, id: 1 }]);
    await game.step(60);
    await game.touch('touchEnd', []);
    await game.step(16);
    expect(speedOf(await game.state())).toBe(0);

    // One thumb on STRIKE: the swing must repeat while the contact is held.
    await game.touch('touchStart', [{ ...strike, id: 2 }]);
    await game.step(120);
    expect((await game.state()).player.attackTime).toBeGreaterThan(0);
    await game.step(120);
    // Real contacts drive real damage, not just events that arrived.
    expect(track(await game.state(), 'warden', anchor).hp).toBe(3 * blade);
    await game.step(400);
    const repeated = await game.state();
    expect(repeated.player.attackTime).toBeGreaterThan(0);
    expect(track(repeated, 'warden', anchor).hp).toBe(2 * blade);

    // A second thumb on the pad: moving while striking must stay possible.
    await game.touch('touchStart', [
      { ...strike, id: 2 },
      { ...pad, id: 3 },
    ]);
    await game.step(120);
    const both = await game.state();
    expect(speedOf(both)).toBeGreaterThan(0);
    expect(both.player.attackTime).toBeGreaterThan(0);
    await game.capture('touch-strike-and-move');

    // Lifting the contacts stops the walk and ends the repeat. Chromium's
    // touch protocol releases the whole contact set at once, so both thumbs
    // come up together here.
    await game.touch('touchEnd', []);
    await game.step(120);
    expect(speedOf(await game.state())).toBe(0);
    await game.step(700);
    expect((await game.state()).player.attackTime).toBe(0);

    // A cancelled contact must release the strike just as a clean lift does.
    await game.touch('touchStart', [{ ...strike, id: 3 }]);
    await game.step(120);
    expect((await game.state()).player.attackTime).toBeGreaterThan(0);
    await game.touch('touchCancel', []);
    await game.step(700);
    expect((await game.state()).player.attackTime).toBe(0);
  });
});
