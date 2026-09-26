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
