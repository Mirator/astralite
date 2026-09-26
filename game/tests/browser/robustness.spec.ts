import type { Page } from '@playwright/test';
import { expect, type Game, type GameWindow, test, WARM_UP } from './helpers.ts';

// What the running game does when the ground goes out from under it: a throw inside the frame loop,
// and a GPU context taken away and handed back. Each scenario breaks its page on purpose, so each gets
// its own rather than leaving a pooled page broken for the next one.
test.use({ isolate: true });
test.describe.configure({ timeout: 120_000 + WARM_UP });

/**
 * A fault planted where every frame will meet it: `update` polls the gamepads before it reads any
 * other input, so a `getGamepads` that throws is a throw from the first line of the world's tick.
 */
const plantFault = (page: Page) => page.evaluate(() => {
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { throw new Error('planted fault'); } });
});

/** The fault is reported once, to the console, and nowhere else; the scenario expects exactly that. */
const expectOneReport = (game: Game) => {
  expect(game.consoleErrors.filter((line) => line.includes('The keep stopped')), 'the fault is reported once').toHaveLength(1);
  expect(game.pageErrors, 'and never escapes as an uncaught error').toEqual([]);
  game.consoleErrors.splice(0);
};

test('a throw inside the real frame loop stops the world once and says so', async ({ page }) => {
  // A bare page rather than the `game` fixture, which takes the clock the moment it opens one: here the
  // page's own animation frames have to be the ones driving `update`, which is the path a player is on.
  // They re-requested themselves before running the tick, so a throw repeated every frame behind a
  // frozen picture.
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error}`));
  await page.goto('/?boot=eager');
  // An eager boot holds `building` until floor 1 is warm, and a press before then is not answered.
  await page.waitForFunction(() => {
    const hook = (window as GameWindow).render_game_to_text;
    return typeof hook === 'function' && !(JSON.parse(hook()) as { building: boolean }).building;
  }, undefined, { timeout: WARM_UP });
  const enter = page.locator('.intro-screen .primary-action');
  await expect(enter).toBeEnabled({ timeout: WARM_UP });
  await enter.click({ timeout: WARM_UP });
  await expect(page.locator('.intro-screen')).toBeHidden({ timeout: WARM_UP });
  await plantFault(page);
  const screen = page.locator('.fault-screen');
  await expect(screen, 'a screen says the keep has stopped').toBeVisible({ timeout: WARM_UP });
  await expect(screen.getByRole('button', { name: 'RELOAD' })).toBeVisible();
  // Given real frames to run, the loop stays stopped: nothing further is reported.
  await page.evaluate(() => new Promise((done) => { let n = 0; const tick = () => (++n < 20 ? requestAnimationFrame(tick) : done(null)); requestAnimationFrame(tick); }));
  const state = JSON.parse(await page.evaluate(() => (window as GameWindow).render_game_to_text!()));
  expect(state.fault).toBe(true);
  expect(errors.filter((line) => line.includes('The keep stopped')), 'the fault is reported once').toHaveLength(1);
  expect(errors.filter((line) => line.startsWith('uncaught')), 'and never escapes as an uncaught error').toEqual([]);
});

test('a throw under the driver clock reaches the driver and the same screen', async ({ game, page }) => {
  await game.step(0);
  await game.enter();
  await game.step(100);
  await plantFault(page);
  await expect(game.step(16), 'the stepped test fails where the throw happened').rejects.toThrow(/planted fault/);
  await expect(page.locator('.fault-screen')).toBeVisible();
  // A stopped world refuses to be stepped rather than stepping a half-run tick again.
  await expect(game.step(16)).rejects.toThrow(/the keep has stopped/);
  expect((await game.state()).fault).toBe(true);
  expectOneReport(game);
});

test('a throw out of a floor build lifts the veil onto the same screen', async ({ game, page }) => {
  // A fresh keep draws its seed from `crypto.getRandomValues` inside the staged build. Before the build
  // chain caught its throws, one there left the loading veil up for good with nothing said.
  await game.step(0);
  await game.enter();
  await game.step(100);
  await page.evaluate(() => {
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: () => { throw new Error('planted fault'); } });
  });
  await game.act('restart');
  await expect(page.locator('.fault-screen')).toBeVisible({ timeout: WARM_UP });
  await expect(page.locator('.loading-veil'), 'the veil does not stay up over it').toBeHidden();
  expect((await game.state()).fault).toBe(true);
  expectOneReport(game);
});

test('a lost GPU context pauses the descent, and a restored one draws the keep again', async ({ game, page }) => {
  await game.step(0);
  await game.enter();
  await game.step(200);
  const brightness = (pixels: Uint8ClampedArray) => { let sum = 0; for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2]; return sum / (pixels.length / 4); };
  const before = brightness(await game.framePixels());
  expect(before, 'the keep was on screen to begin with').toBeGreaterThan(10);

  await page.evaluate(() => {
    const canvas = document.querySelector('.game-canvas canvas') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2')!;
    (window as Window & { __lose?: WEBGL_lose_context | null }).__lose = gl.getExtension('WEBGL_lose_context');
    (window as Window & { __lose?: WEBGL_lose_context | null }).__lose!.loseContext();
  });
  await expect(page.locator('.display-notice'), 'the loss is said on screen').toBeVisible();
  expect((await game.state()).mode, 'and the world is held rather than fought behind a frozen image').toBe('paused');

  await page.evaluate(() => (window as Window & { __lose?: WEBGL_lose_context | null }).__lose!.restoreContext());
  await expect(page.locator('.display-notice'), 'the notice lifts when the display comes back').toBeHidden();
  expect((await game.state()).mode, 'and the player chooses when to step back in').toBe('paused');

  await page.keyboard.press('Escape');
  await game.step(200);
  expect((await game.state()).mode).toBe('playing');
  const after = brightness(await game.framePixels());
  // Every texture, target and program is rebuilt on the new context, or the frame comes back black.
  expect(after, 'the restored context draws the keep, not a black frame').toBeGreaterThan(before * 0.6);
  expect((await game.state()).fault).toBe(false);
});
