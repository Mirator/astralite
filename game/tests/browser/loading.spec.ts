import { expect, type GameWindow, test, WARM_UP } from './helpers.ts';

// A boot is the thing under test here, so a page that is already booted has nothing to show. Every
// scenario here needs its own load. Each fresh load also pays a cold shader warm-up behind the veil
// (see WARM_UP in helpers.ts), so the scenarios get room for it on top of the usual ceiling.
test.use({ isolate: true });
test.describe.configure({ timeout: 120_000 + WARM_UP });

type VeilWindow = Window & { veilSeen?: string | null };
type HeldWindow = Window & { releaseFrames?: () => void };

/**
 * The menu is what a visitor sees first, so it has to be in the document the server sends: rendered by
 * an effect, it would arrive after the whole bundle, and the page would be a black rectangle until then.
 * The veil is not in it. Nothing is waited on before the menu.
 */
test('the menu ships inside the prerendered page and the veil does not', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('intro-card');
  expect(html).toContain('ENTER THE KEEP');
  expect(html).toContain('Controls &amp; journey');
  expect(html).not.toContain('loading-veil');
});

/**
 * The keep is built a couple of frames after the page mounts, behind the menu. A press that lands before
 * then is not lost and does not start a run with no floor: it raises the loading bar and is answered on
 * the keep. Animation frames are held from before the page's own script runs, so "before the build" is
 * guaranteed by construction rather than by out-racing it; Playwright's own frame checks run in an isolated
 * world and are not held.
 */
test('a press that beats the build raises the loading bar and enters on the new keep', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const held: FrameRequestCallback[] = [];
    const native = window.requestAnimationFrame.bind(window);
    let holding = true;
    window.requestAnimationFrame = (callback) => {
      if (!holding) return native(callback);
      held.push(callback);
      return 0;
    };
    (window as HeldWindow).releaseFrames = () => {
      holding = false;
      for (const callback of held.splice(0)) native(callback);
    };
  });
  await page.goto('/');
  const enter = page.locator('.intro-screen .primary-action');
  await expect(enter).toBeEnabled();
  expect(
    await page.evaluate(() => typeof (window as GameWindow).render_game_to_text),
    'floor 1 was built before any frame ran',
  ).toBe('undefined');
  await expect(page.locator('.loading-veil')).toHaveCount(0);

  await enter.click();
  const veil = page.locator('.loading-veil');
  await expect(veil).toBeVisible();
  await expect(veil).toContainText('Waking the keep');
  await expect(veil.locator('.veil-bar')).toBeVisible();
  // Still held: the press is waiting on the keep, not answered without one.
  await expect(page.locator('.game-shell')).toHaveClass(/pre-start/);

  await page.evaluate(() => (window as HeldWindow).releaseFrames?.());
  await page.waitForFunction(
    () => typeof (window as GameWindow).render_game_to_text === 'function',
  );
  // The hooks go up with the floor; the veil stays through the shader warm-up and lifts on the keep.
  await expect(veil).toHaveCount(0, { timeout: WARM_UP });
  await expect(page.locator('.intro-screen')).toBeHidden();
  const state = await page.evaluate(
    () => JSON.parse((window as GameWindow).render_game_to_text!()) as { mode: string; floor: { level: number } },
  );
  expect(state.mode).toBe('playing');
  expect(state.floor.level).toBe(1);
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

  // Raised in the same breath as the ask, and read in it too: the veil is up for three frames, and a
  // second round-trip to ask about it is a race a busy runner loses, reporting a veil that already lifted.
  const raised = await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('dungeon-action', { detail: 'restart' }));
    const hook = (window as GameWindow).render_game_to_text;
    if (!hook) throw new Error('render_game_to_text is gone');
    return (JSON.parse(hook()) as { building: boolean }).building;
  });
  expect(raised).toBe(true);

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

/**
 * LAST KEEP is a menu item that enters the floor 1 a previous visit left, not a button that swaps the
 * floor behind the menu and waits for a second press. The stored seed is read on mount, before floor 1
 * overwrites it.
 */
test.describe('with a keep remembered from a previous visit', () => {
  const remembered = 0x2468ace;
  test.use({
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://127.0.0.1:${process.env.GAME_TEST_PORT ?? 3000}`,
          localStorage: [{ name: 'drowned-keep:seed', value: String(remembered) }],
        },
      ],
    },
  });

  test('LAST KEEP enters that keep in one press', async ({ game, page }) => {
    await page.getByRole('button', { name: 'Last keep' }).click();
    await game.built();
    await expect(page.locator('.intro-screen')).toBeHidden();
    const state = await game.state();
    expect(state.mode).toBe('playing');
    expect(state.floor.seed).toBe(remembered);
  });
});
