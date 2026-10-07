import { freshMeta, pearlsFor } from '../../app/dungeon-meta.ts';
import { expect, press, stageBlow, test, veilSeen, watchVeil } from './helpers.ts';

// Plan 020 Stage D: death and return. A finished run, won or lost, has one way off its card - RETURN TO THE ALTAR, which runs a veiled build of the hall - and
// the hall's pause menu (and only it) has LEAVE TO TITLE. A seed is retried by the `restart:<seed>` command alone. These open the page on the hall (D11), so they
// run the product's own loop - hall, way down, floor one, a real blow, the card, the hall again - and stay on the PR gate. The blow is real (a staged body
// swings); the way down is taken with the real swap key and only the walk to it is a teleport.
test.use({ hall: true });

const runLog = (game: { page: import('@playwright/test').Page }) => game.page.evaluate(
  () => (window as unknown as { dungeonTest: { runLog: () => { floor: number; won: boolean; kills: number; chambers: number; cause: string | null; pearls: number }[] } }).dungeonTest.runLog(),
);

test('a death returns to the hall: the card has one button and no other way off, a seed is retried by the hook alone, and what the run banked waits in the shop', async ({ game, page }) => {
  // 160 held going in, so the bank has to add to a balance it read from the save, and the shop has something to show that is not zero.
  await game.setMeta({ ...freshMeta(), pearls: 160 });
  await game.enter();
  expect((await game.state()).hall, 'precondition: the run starts in the hall').toBe(true);
  await game.takeWayDown();
  const run = await game.state();
  expect([run.hall, run.floor.level, run.mode], 'precondition: the way down led to floor one').toEqual([false, 1, 'playing']);

  // Mid-run, the pause menu has no way out of the run (D10): LEAVE TO TITLE is the hall's.
  await page.keyboard.press('Escape');
  await game.step(16);
  const pauseMenu = page.getByRole('navigation', { name: 'Pause menu' });
  await expect(pauseMenu).toBeVisible();
  await expect(pauseMenu.getByRole('button'), 'a run\'s pause menu offers a way out of the run').toHaveText([/^RESUME/, 'Floor map', /^Controls & journey/, /^Settings/]);
  await page.keyboard.press('Escape');
  await game.step(16);
  expect((await game.state()).mode).toBe('playing');

  // Floor 2, so the death has a floor behind it to pay for (a death on floor one with nothing felled pays nothing, and a bank that adds nothing would pass);
  // the knight is then killed by a real blow.
  await game.buildFloor(2);
  expect((await game.state()).floor.level, 'precondition: the run is on floor 2').toBe(2);
  const { kind } = await stageBlow(game, 1);
  expect((await game.state()).health, 'precondition: the blow is lethal').toBe(1);
  await game.step(300);
  expect((await game.state()).mode, 'the staged blow never landed').toBe('lost');
  const first = (await runLog(game)).at(-1)!;
  expect(first.cause, 'the run did not end by the body that was staged').toBe(kind);
  const earnedFirst = pearlsFor(first);
  expect(earnedFirst, 'precondition: the run earned something, or a bank that adds nothing would pass').toBeGreaterThan(0);

  // The card: what happened, what it paid, and one button.
  const card = page.locator('.result-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.end-kicker')).toHaveText('FLOOR 2 · FAILED');
  await expect(card.getByRole('heading')).toHaveText('The dark takes you.');
  await expect(card.locator('.run-cause')).toBeVisible();
  await expect(card.locator('.run-pearls')).toHaveText(`+${earnedFirst} ${earnedFirst === 1 ? 'pearl' : 'pearls'} · ${160 + earnedFirst} held`);
  await expect(card.getByRole('button'), 'the death card does not offer exactly one way off').toHaveText(['RETURN TO THE ALTAR']);
  await expect(page.getByRole('button', { name: /NEW DESCENT|SAME KEEP|TO THE GATE/ }), 'a retired button is still on the card').toHaveCount(0);
  // The card takes focus first, so a dodge still held cannot answer it; the button is the focus a moment later, so Enter does.
  await expect(card.getByRole('button'), 'the card\'s one button never took focus').toBeFocused();

  // The seed is still reachable, for playtests, through the command alone: a straight retry of any floor one, from the card.
  await game.act('restart:4242');
  await game.built();
  await game.step(16);
  const retry = await game.state();
  expect([retry.hall, retry.mode, retry.floor.level, retry.floor.seed], 'restart:<seed> did not retry the seed directly').toEqual([false, 'playing', 1, 4242]);
  await expect(card).toHaveCount(0);

  // Die again, and take the button: a veiled build of the hall.
  await stageBlow(game, 1);
  await game.step(300);
  expect((await game.state()).mode, 'the second staged blow never landed').toBe('lost');
  const second = (await runLog(game)).at(-1)!;
  const total = 160 + earnedFirst + pearlsFor(second);
  expect((await game.meta()).pearls, 'the two runs were not banked into the save').toBe(total);
  await watchVeil(page);
  await card.getByRole('button', { name: 'RETURN TO THE ALTAR' }).click();
  await game.built();
  await game.step(16);
  const veil = await veilSeen(page);
  expect(veil, 'the button raised no veil: it did not build anything').not.toBeNull();
  expect(veil, 'the veil did not say the tide was carrying him back to the hall').toContain('The tide carries you back');
  const hall = await game.state();
  expect([hall.hall, hall.mode, hall.floor.seed === 4242], 'the button did not bring him back to the hall').toEqual([true, 'playing', false]);
  expect(hall.health, 'the run that brought him back was not dealt afresh').toBe(hall.maxHealth);
  await expect(card).toHaveCount(0);

  // The pearls are in the shop, visible and spendable.
  const altar = hall.hallProps!.altar!;
  await game.teleport(altar.x, altar.z);
  await game.step(64);
  await press(page, 'swap');
  await game.step(16);
  await expect(page.locator('.altar-purse')).toHaveText(`${total} pearls held`);
  await page.keyboard.press('Escape');
  await game.step(16);
  expect((await game.state()).altarOpen).toBe(false);

  // The hall's pause menu has LEAVE TO TITLE, and it goes to the slot picker with the run still no further on.
  await page.keyboard.press('Escape');
  await game.step(16);
  await expect(pauseMenu.getByRole('button')).toHaveText([/^RESUME/, 'LEAVE TO TITLE', /^Controls & journey/, /^Settings/]);
  await pauseMenu.getByRole('button', { name: 'LEAVE TO TITLE' }).click();
  await expect(page.locator('.slot-picker'), 'LEAVE TO TITLE did not go to the slot picker').toBeVisible();
  expect((await game.state()).mode, 'the title is not showing').toBe('ready');
  await page.locator('.slot-choose[data-slot="1"]').click();
  await expect(page.locator('.intro-screen')).toBeHidden();
  await game.step(16);
  const back = await game.state();
  expect([back.hall, back.mode, back.slot], 'choosing the slot did not put him back in the hall').toEqual([true, 'playing', 1]);
});

test('a win returns to the hall by the same single button', async ({ game, page }) => {
  await game.enter();
  await game.takeWayDown();
  // The last floor is staged with the dev arena (its stair is open from the start, no warden bars it) and the win itself is real: stand on the stair, take it,
  // and answer the card that says the floor is complete. `progression.spec.ts` plays the three floors through.
  await page.evaluate(() => (window as unknown as { dungeonTest: { buildArena: (roster: string[], level: number) => void } }).dungeonTest.buildArena(['guard'], 3));
  await game.step(64);
  const staged = await game.state();
  expect([staged.floor.level, staged.arena?.level, staged.objective.stairOpen], 'precondition: floor 3 with its stair open').toEqual([3, 3, true]);
  await game.teleport(staged.stair.x, staged.stair.z);
  await game.step(200);
  expect((await game.state()).objective.onStair, 'precondition: the knight stands on the stair').toBe(true);
  await press(page, 'swap');
  await game.step(32);
  await expect(page.locator('.success-screen')).toBeVisible();
  await page.locator('.success-screen button').click();
  await game.built();
  await game.step(16);
  expect((await game.state()).mode, 'the last floor did not end the run').toBe('won');

  const card = page.locator('.result-card');
  await expect(card.locator('.end-kicker')).toHaveText('THE KEEP IS BEHIND YOU');
  await expect(card.getByRole('heading')).toHaveText('You climb into the dawn.');
  await expect(card.getByRole('button'), 'the win card does not offer exactly one way off').toHaveText(['RETURN TO THE ALTAR']);
  await expect(page.getByRole('button', { name: /NEW DESCENT|SAME KEEP|TO THE GATE/ })).toHaveCount(0);
  await card.getByRole('button').click();
  await game.built();
  await game.step(16);
  const hall = await game.state();
  expect([hall.hall, hall.mode], 'the win card did not bring him back to the hall').toEqual([true, 'playing']);
  await expect(card).toHaveCount(0);
});
