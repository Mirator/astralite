import { chainLength, TIDEBLADE } from '../../app/dungeon-weapon.ts';
import { expect, test } from './helpers.ts';

// Holding the strike key used to restart an identical swing forever, which made holding it strictly
// optimal and left the input with no rhythm at all. The two light melee arms now swing a string: two
// cuts and a finish that is slower, heavier and committed for longer. The rules - linking inside the
// window, going cold outside it, the finish costing more, a dodge breaking the string, an arm with no
// string - are held in tests/dungeon-player.test.ts. What is left here is that the running game is
// wired to them: a held key really walks the string.

test('a held strike walks the string and loops it', async ({ game, page }) => {
  await game.enter();
  await game.step(120);
  expect((await game.state()).player.chain.beats, 'the sword swings three').toBe(chainLength(TIDEBLADE));

  await page.keyboard.down('Space');
  // The order beats came up in, not just which: beat 0 is where a string opens anyway, so only a return
  // to it after the finish shows the string looping rather than stalling on its last beat.
  const order: number[] = [];
  for (let i = 0; i < 160 && order.length < 4; i++) {
    await game.step(16);
    const state = await game.state();
    if (state.player.attackTime > 0 && order[order.length - 1] !== state.player.chain.beat) order.push(state.player.chain.beat);
  }
  await page.keyboard.up('Space');
  expect(order, 'a held key walks every beat of the string and opens it again').toEqual([0, 1, 2, 0]);
});
