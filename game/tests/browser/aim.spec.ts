import { expect, SCREEN_DIRECTIONS, test } from './helpers.ts';

// Aim used to be movement: the swing took its direction from whatever the keys said on the frame it
// started, so the knight could only ever strike in the eight directions he could walk in, and could
// never strike in one direction while retreating in another. These are the tests for the two ways out
// of that — a pointer, which is exact, and a snap, which closes the gap the keys leave.

/** How far along a screen axis a facing points. Positive is that way; negative is the other. */
const along = (facing: { x: number; z: number }, direction: { x: number; z: number }) =>
  facing.x * direction.x + facing.z * direction.z;

const canvasBox = async (page: import('@playwright/test').Page) => {
  const box = await page.locator('canvas').boundingBox();
  expect(box, 'the game canvas has no box to point at').not.toBeNull();
  return box!;
};

test('a cursor aims the swing while the keys are walking the other way', async ({ game, page }) => {
  await game.enter();
  await game.step(120);

  const box = await canvasBox(page);
  // Hard left of the picture, vertically centred: unambiguously the screen's -right, whatever the
  // floor under it happens to be.
  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.5);
  await game.step(32);

  // Walking right while cutting left is the thing that was impossible before, and the single reason
  // a pointer is worth having. A movement key must not take the aim back.
  await page.keyboard.down('ArrowRight');
  await game.step(200);
  const walking = await game.state();
  expect(along(walking.player.velocity, SCREEN_DIRECTIONS.right),
    'the knight is travelling to the right of the screen').toBeGreaterThan(0);

  await page.mouse.down({ button: 'left' });
  await game.step(16);
  const swung = await game.state();
  expect(swung.player.attackTime, 'the swing started').toBeGreaterThan(0);
  expect(along(swung.player.facing, SCREEN_DIRECTIONS.right),
    'the swing went out toward the cursor, not along the key').toBeLessThan(0);
  // And he is still walking the other way, mid-swing.
  expect(along((await game.state()).player.velocity, SCREEN_DIRECTIONS.right)).toBeGreaterThan(0);

  await page.mouse.up({ button: 'left' });
  await page.keyboard.up('ArrowRight');
});

test('striking from the keyboard takes the aim back from the cursor', async ({ game, page }) => {
  await game.enter();
  await game.step(120);

  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.5);
  await game.step(32);
  await page.mouse.down({ button: 'left' });
  await game.step(16);
  expect(along((await game.state()).player.facing, SCREEN_DIRECTIONS.right)).toBeLessThan(0);
  await page.mouse.up({ button: 'left' });
  await game.step(600);

  // The cursor has not moved. Someone who reaches for Space is playing on the keyboard, and must not
  // find every swing aimed at whatever corner the intro card left the pointer in.
  await page.keyboard.down('ArrowRight');
  await game.step(120);
  await page.keyboard.press('Space');
  await game.step(16);
  const swung = await game.state();
  expect(along(swung.player.facing, SCREEN_DIRECTIONS.right),
    'the keyboard strike reclaimed the aim from a cursor that never moved').toBeGreaterThan(0.9);
  await page.keyboard.up('ArrowRight');
});

test('a cursor that leaves the canvas stops aiming', async ({ game, page }) => {
  await game.enter();
  await game.step(120);

  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.5);
  await game.step(32);

  await page.keyboard.down('ArrowDown');
  await game.step(200);
  // Out of the canvas entirely. The facing must fall back to the key rather than stay pinned at
  // wherever the pointer was when it went out.
  await page.mouse.move(box.x + box.width * 0.5, box.y - 40);
  await game.step(32);
  await page.keyboard.press('Space');
  await game.step(16);
  const swung = await game.state();
  expect(along(swung.player.facing, SCREEN_DIRECTIONS.down)).toBeGreaterThan(0.9);
  await page.keyboard.up('ArrowDown');
});

test('the left mouse button strikes and holds a strike going', async ({ game, page }) => {
  await game.enter();
  await game.step(120);

  const box = await canvasBox(page);
  const at = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.32 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: 'left' });
  await game.step(16);
  expect((await game.state()).player.attackTime, 'the button swung').toBeGreaterThan(0);

  // Held, the swing restarts on its own exactly as a held Space does. Sampling across more than one
  // full swing is what tells a repeat from a single long animation.
  let swings = 0;
  for (let i = 0; i < 60; i++) {
    await game.step(16);
    if ((await game.state()).player.attackTime > 0) swings++;
  }
  expect(swings, 'the blade kept working while the button was down').toBeGreaterThan(40);

  await page.mouse.up({ button: 'left' });
  await game.step(700);
  expect((await game.state()).player.attackTime, 'releasing the button stops it').toBe(0);
});

test('the right mouse button dodges', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await game.step(16);
  expect((await game.state()).player.dashTime).toBeGreaterThan(0);
});
