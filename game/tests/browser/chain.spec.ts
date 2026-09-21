import { chainLength, TIDEBLADE } from '../../app/dungeon-weapon.ts';
import { expect, test } from './helpers.ts';

// Holding the strike key used to restart an identical swing forever, which made holding it strictly
// optimal and left the input with no rhythm at all. The two light melee arms now swing a string: two
// cuts and a finish that is slower, heavier and committed for longer. These are the tests for the
// string advancing, for it resetting, and for the finish actually costing something.

const LINK = TIDEBLADE.chain!.window;

test('a held strike walks the string and loops it', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  expect((await game.state()).player.chain.beats, 'the sword swings three').toBe(chainLength(TIDEBLADE));

  await page.keyboard.down('Space');
  const seen = new Set<number>();
  for (let i = 0; i < 160; i++) {
    await game.step(16);
    const state = await game.state();
    if (state.player.attackTime > 0) seen.add(state.player.chain.beat);
  }
  await page.keyboard.up('Space');
  expect([...seen].sort((a, b) => a - b), 'every beat of the string came up under a held key')
    .toEqual([0, 1, 2]);
});

test('the string resets when the knight stops swinging', async ({ game, page }) => {
  await game.enter();
  await game.step(120);

  await page.keyboard.press('Space');
  await game.step(16);
  expect((await game.state()).player.chain.beat, 'the string opens at its first beat').toBe(0);

  // Straight into the next one: inside the link window, so the string continues.
  await game.step(Math.round(TIDEBLADE.duration * 1000));
  await page.keyboard.press('Space');
  await game.step(16);
  expect((await game.state()).player.chain.beat, 'a prompt second strike continues it').toBe(1);

  // Now wait the window out. The next strike has to open a new string rather than finish the old one.
  await game.step(Math.round((TIDEBLADE.duration + LINK) * 1000) + 300);
  const idle = await game.state();
  expect(idle.player.attackTime).toBe(0);
  expect(idle.player.chain.idle, 'the string has gone cold').toBeGreaterThan(LINK);

  await page.keyboard.press('Space');
  await game.step(16);
  expect((await game.state()).player.chain.beat, 'a late strike opens a new string').toBe(0);
});

test('the finish hits harder and commits for longer than the opener', async ({ game, page }) => {
  await game.enter();
  await game.step(120);

  const beatAt = async (want: number) => {
    for (let i = 0; i < 200; i++) {
      const state = await game.state();
      if (state.player.attackTime > 0 && state.player.chain.beat === want) return state.player.chain;
      await game.step(16);
    }
    throw new Error(`beat ${want} never came up`);
  };

  await page.keyboard.down('Space');
  const opener = await beatAt(0);
  const finish = await beatAt(2);
  await page.keyboard.up('Space');

  expect(finish.damage, 'the finish is worth more than the opener').toBeGreaterThan(opener.damage);
  expect(finish.duration, 'and takes longer to throw').toBeGreaterThan(opener.duration);
});

test('a dodge breaks the string rather than carrying it', async ({ game, page }) => {
  await game.enter();
  await game.step(120);

  // Hold the key and wait for the string to get past its first beat rather than timing the press by
  // hand: where the beat boundary falls is the swing's business, not the test's.
  await page.keyboard.down('Space');
  let reached = false;
  for (let i = 0; i < 200 && !reached; i++) {
    await game.step(16);
    const state = await game.state();
    reached = state.player.attackTime > 0 && state.player.chain.beat > 0;
  }
  await page.keyboard.up('Space');
  expect(reached, 'the string never got past its opening beat').toBe(true);

  // A dodge is a way out of a committed string as well as out of a blow. The dash buffers behind a
  // live blade, so give it long enough to actually fire.
  await page.keyboard.press('ShiftLeft');
  await game.step(400);
  const dodged = await game.state();
  expect(dodged.player.dashCooldown, 'the dodge fired').toBeGreaterThan(0);
  expect(dodged.player.chain.beat, 'and reset the string').toBe(0);

  await game.step(1200);
  await page.keyboard.press('Space');
  await game.step(16);
  expect((await game.state()).player.chain.beat, 'the next strike opens fresh').toBe(0);
});

test('an arm without a string swings the same cut every time', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  // The maul is one of the five arms deliberately left alone: a chain on a slow committed heave is a
  // different weapon, not a better one.
  await game.equip('maul');
  await game.step(32);
  expect((await game.state()).player.chain.beats).toBe(1);

  await page.keyboard.down('Space');
  for (let i = 0; i < 120; i++) {
    await game.step(16);
    expect((await game.state()).player.chain.beat, 'the maul never leaves its only beat').toBe(0);
  }
  await page.keyboard.up('Space');
});
