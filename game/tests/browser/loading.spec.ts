import { expect, test } from './helpers.ts';

// The veil is what a boot looks like from outside, so a page that is already booted has nothing
// to show. Every scenario here needs its own load.
test.use({ isolate: true });

type VeilWindow = Window & { veilSeen?: string | null };

/**
 * The wait this screen covers begins while the bundle is still arriving, so a
 * veil raised by an effect would be raised long after the black rectangle it
 * exists to replace. It has to be in the document the server sends.
 */
test('the loading veil ships inside the prerendered page', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('loading-veil');
  expect(html).toContain('Waking the keep');
});

/**
 * Observed rather than polled: the veil is up for a build and three frames, and
 * a poll that happened to arrive on the far side of that would report nothing
 * and pass. The observer records the first insertion, whenever it lands.
 */
test('a fresh run waits behind the veil and lifts it on the new keep', async ({
  game,
  page,
}) => {
  await game.enter();
  await page.evaluate(() => {
    const watched = window as VeilWindow;
    watched.veilSeen = null;
    new MutationObserver(() => {
      const veil = document.querySelector('.loading-veil');
      if (veil && !watched.veilSeen) watched.veilSeen = veil.textContent;
    }).observe(document.body, { childList: true, subtree: true });
  });

  await game.act('restart');
  // Raised in the same breath as the ask: the build itself is two frames away.
  expect((await game.state()).building).toBe(true);

  await game.built();
  await expect(page.locator('.loading-veil')).toBeHidden();
  expect(await page.evaluate(() => (window as VeilWindow).veilSeen)).toContain(
    'A new keep rises',
  );

  const fresh = await game.state();
  expect(fresh.floor.level).toBe(1);
  expect(fresh.experience.total).toBe(0);
});

/**
 * The status each caller guards on does not change until the work the veil is
 * holding actually runs, so without a flag of its own a second press would
 * queue a second build of the same floor. Seeds are pinned in order, which is
 * what makes a spare build visible: it would eat the next one in the list.
 */
test('a second press while the veil is up does not build a second keep', async ({
  game,
  seeds,
}) => {
  await game.enter();
  // Both presses in one dispatch. Sent as two calls they are two round-trips racing the three frames
  // the veil waits out, which is a race this test used to win on an idle machine and lose on a busy
  // one - and losing it looks exactly like the bug it is here to catch.
  await game.act('restart', 'restart');
  await game.built();
  expect((await game.state()).floor.seed).toBe(seeds[1] >>> 0);
});
