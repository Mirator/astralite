import { freshMeta } from '../../app/dungeon-meta.ts';
import { VEIL_STAGES, veilProgress } from '../../app/dungeon-veil.ts';
import { DEFAULT_SEEDS, enterKeep, expect, type GameWindow, openSlots, chooseSlot, pinSeeds, test, WARM_UP } from './helpers.ts';

// A boot is the thing under test here, so a page that is already booted has nothing to show. Every
// scenario here needs its own load. Each fresh load also pays a cold shader warm-up behind the veil
// (see WARM_UP in helpers.ts), so the scenarios get room for it on top of the usual ceiling.
test.use({ isolate: true });
test.describe.configure({ timeout: 120_000 + WARM_UP });

type VeilWindow = Window & { veilSeen?: string | null; veilClass?: string | null; veilObserver?: MutationObserver };
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
 * Plan 015 Stage A, target 1: before ENTER, nothing runs. `compileShader` is hooked before the page's own
 * script runs, so a compile hidden inside module evaluation or a lazy effect would still be caught; the
 * hook goes up with the floor, so its absence after two full seconds idle is "no floor built", not "not
 * built yet"; and `requestAnimationFrame` is hooked the same way `frame-clock.spec.ts` holds it, so a
 * frame loop that requested itself once and never drew would still be counted. Vite's own client and
 * React's scheduler use neither API in this app, which is what makes a bare zero the right assertion
 * rather than a fuzzier "stays low" one - if a framework dependency ever changes that, the fix is a
 * narrower probe here, not a wider tolerance.
 */
test('the idle page compiles nothing, builds nothing and requests no frame', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __probeCompiles: number; __probeFrames: number };
    w.__probeCompiles = 0;
    w.__probeFrames = 0;
    const proto = (window as unknown as { WebGL2RenderingContext?: { prototype: Record<string, unknown> } })
      .WebGL2RenderingContext?.prototype;
    if (proto) {
      const compileShader = proto.compileShader as (this: WebGL2RenderingContext, shader: WebGLShader) => void;
      proto.compileShader = function (this: WebGL2RenderingContext, shader: WebGLShader) {
        w.__probeCompiles++;
        return compileShader.call(this, shader);
      };
    }
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => { w.__probeFrames++; return raf(callback); };
  });
  await page.goto('/');
  await page.waitForTimeout(2000);
  const idle = await page.evaluate(() => {
    const w = window as unknown as {
      __probeCompiles: number;
      __probeFrames: number;
      render_game_to_text?: unknown;
    };
    return {
      compiles: w.__probeCompiles,
      frames: w.__probeFrames,
      hookExists: typeof w.render_game_to_text === 'function',
    };
  });
  expect(idle.compiles, 'a shader compiled before any press').toBe(0);
  expect(idle.hookExists, 'floor 1 (or its window hooks) exists before any press').toBe(false);
  expect(idle.frames, 'the idle page asked for an animation frame').toBe(0);
});

/**
 * Nothing is built until ENTER is pressed (plan 015 Stage A); the press is what builds the keep, not a
 * race the press might lose against a build already under way. Animation frames are held from before the
 * page's own script runs, so this holds even if a future change reintroduced work started at mount:
 * "before the build" is guaranteed by construction rather than by out-racing it. Playwright's own frame
 * checks run in an isolated world and are not held, which is what proves the veil and its bar paint
 * without needing a single frame - the whole point of a loading screen that must show up before the work
 * it is covering for gets to run.
 */
test('the keep is built on the press, not before it', async ({
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

  // Plan 020: ENTER THE KEEP opens the slot picker, which builds nothing; the slot's card is the press that raises the veil.
  await openSlots(page);
  await expect(page.locator('.loading-veil'), 'opening the picker raised the loading veil').toHaveCount(0);
  expect(
    await page.evaluate(() => typeof (window as GameWindow).render_game_to_text),
    'opening the picker built floor 1',
  ).toBe('undefined');
  await chooseSlot(page);
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
 * Plan 015 Stage C.1: `stagedBuild`'s program poll can span real seconds once
 * `KHR_parallel_shader_compile` is exercised, where the wait used to close over one synchronous burst
 * (the first render's own `getUniforms`/`getAttributes` sweep). A `dungeonTest.reset()` landing inside
 * that window - the same shape a pooled scenario's own setup issues, and exactly what caught this in
 * development - found `veiled`'s `building` guard unclaimed by the boot it was racing (`boot` bypasses
 * `veiled` and calls `stagedBuild` directly) and started a second, concurrent build. Whichever superseded
 * the other via `buildToken` left the loser's `.then` seeing `ok === false`; when the loser was the boot,
 * it returned before ever setting `warmed`, and every press after that hung behind `enterWhenBuilt` with
 * nothing left to answer it. `boot` now claims `building` too, so the reset below is silently dropped
 * rather than racing it - what this proves is that dropping it is safe: no page error, the boot it
 * interrupted still lands, and a real press afterward still works.
 */
test('a reset issued while the boot is still polling its programs does not corrupt it', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('/?boot=eager');
  // As early as the hooks allow - well before the poll has had time to finish - so this lands inside the
  // async window, not after it.
  await page.waitForFunction(
    () => typeof (window as GameWindow).render_game_to_text === 'function',
    undefined,
    { timeout: WARM_UP },
  );
  // Read `building` and reset in the same task: a reset that lands after the boot finished would pass
  // everything below trivially, so the test has to see that it hit the window it is about.
  const inWindow = await page.evaluate(() => {
    const hooks = window as GameWindow;
    const building = (JSON.parse(hooks.render_game_to_text!()) as { building: boolean }).building;
    hooks.dungeonTest?.reset();
    return building;
  });
  expect(inWindow, 'the reset landed after the boot had finished, so the race was never run').toBe(true);
  // The boot this interrupted still has to land, whether or not the reset above did anything.
  await page.waitForFunction(
    () => {
      const hook = (window as GameWindow).render_game_to_text;
      return typeof hook === 'function' && !(JSON.parse(hook()) as { building: boolean }).building;
    },
    undefined,
    { timeout: WARM_UP },
  );
  // And a real press afterward has to work - this is exactly what hung before `boot` claimed `building`.
  await enterKeep(page);
  await expect(page.locator('.intro-screen')).toBeHidden({ timeout: WARM_UP });
  const state = await page.evaluate(
    () => JSON.parse((window as GameWindow).render_game_to_text!()) as { mode: string },
  );
  expect(state.mode).toBe('playing');
  expect(errors, 'the interrupted boot left a page error behind').toEqual([]);
});

// These four need a booted page, not a boot: `dungeonTest.reset` is the same sliced, veiled `restart` they
// are about, so the pooled page exercises exactly the code a fresh load would, without paying for one.
test.describe('on an already booted page', () => {
  test.use({ isolate: false });

  /**
   * Plan 015 Stage C.2: `buildFloor` is a generator now, yielding at its existing `phase()` boundaries, but
   * `dungeonTest.buildFloor` still drains it synchronously in one call - the same generator the sliced
   * boot/restart path drives incrementally across frames instead. This builds the same seed both ways and
   * holds the floor, its graphics summary and its enemy spawns to be identical: same rooms, same edges,
   * same motifs, same spawns, in every field - proof that slicing when a build runs does not change what
   * it builds. `buildMs` is excluded, the same way the pooled leak guard excludes it elsewhere in this
   * suite: wall-clock milliseconds describe the machine, not the floor, and cannot match between a build
   * that ran in one synchronous burst and one spread across frames.
   */
  test('a floor built through the sliced path is identical to the synchronous one, for the same seed', async ({
    game,
    page,
  }) => {
    const seed = 0x51a7;
    // Plan 019 Stage C: the racks are part of what a build decides. Floor one's gate lays none any more (plan 020 moved the armoury to the hall, whose own
    // sliced-against-synchronous build is the next scenario), so the save owns three arms to prove that: both builds below read it and stand no rack.
    await game.setMeta({ ...freshMeta(), arms: ['tideblade', 'spear', 'maul'], arm: 'tideblade' });
    const capture = () =>
      page.evaluate(() => {
        const snapshot = JSON.parse((window as GameWindow).render_game_to_text!()) as {
          floor: unknown;
          graphics: unknown;
          enemies: unknown;
          features: unknown;
          stair: unknown;
          racks: unknown;
          remaining: unknown;
        };
        // Everything a build decides: the layout, its dressing, the spawns, the stair, the racks and the props.
        return { floor: snapshot.floor, graphics: snapshot.graphics, enemies: snapshot.enemies, features: snapshot.features, stair: snapshot.stair, racks: snapshot.racks, remaining: snapshot.remaining };
      });

    // The sliced path: the same generator, driven incrementally by `restart` (via `dungeonTest.reset`).
    await page.evaluate((s) => (window as GameWindow).dungeonTest!.reset(s), seed);
    await game.built();
    const sliced = await capture();
    expect(sliced.racks, 'floor one\'s gate laid a rack, owned arms or not').toEqual([]);

    // The synchronous reference: dungeonTest.buildFloor drains the identical generator in one call.
    await page.evaluate((s) => (window as GameWindow).dungeonTest!.buildFloor(1, s), seed);
    const unsliced = await capture();

    expect(sliced).toEqual(unsliced);
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
    // Somewhere a restart has to undo: a deeper floor and some experience. Without them the level and
    // experience checks below hold before the restart as well as after it.
    await game.buildFloor(2);
    await game.grantXp(5);
    const deeper = await game.state();
    expect(deeper.floor.level).toBe(2);
    expect(deeper.experience.total).toBeGreaterThan(0);
    await page.evaluate(() => {
      const watched = window as VeilWindow;
      watched.veilSeen = null; watched.veilClass = null;
      watched.veilObserver = new MutationObserver(() => {
        const veil = document.querySelector('.loading-veil');
        if (veil && !watched.veilSeen) { watched.veilSeen = veil.textContent; watched.veilClass = veil.className; }
      });
      watched.veilObserver.observe(document.body, { childList: true, subtree: true });
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
    // A software rasteriser gets the plain veil - no fog layers, one flat background - and a GPU the full
    // one; the same switch as the post chain, so the two never disagree about what the machine can draw.
    expect(
      (await page.evaluate(() => (window as VeilWindow).veilClass))?.includes('veil-plain'),
      `the veil's dressing did not follow the ${fresh.render.quality} post chain`,
    ).toBe(fresh.render.quality === 'reduced');
    // The page is shared with the next scenario: leave nothing watching it.
    await page.evaluate(() => { (window as VeilWindow).veilObserver?.disconnect(); });
  });

  /**
   * Under a driver's clock the frame loop is stopped and the driver draws when it asks to. A build behind
   * the veil used to draw two frames of its own anyway - the warm-up frames a player needs - and on a
   * software rasteriser those two scene passes were the largest single cost of every pooled reset. The
   * driver reads exactly the frames it asked for, before and after a rebuild.
   */
  test('a keep raised under a driver\'s clock draws no frame the driver did not ask for', async ({
    game,
  }) => {
    await game.enter();
    await game.step(0, true);
    const before = (await game.state()).render.frames;
    await game.act('restart');
    await game.built();
    expect(
      (await game.state()).render.frames,
      'the build behind the veil drew frames of its own under manual time',
    ).toBe(before);
    await game.step(0, true);
    expect((await game.state()).render.frames).toBe(before + 1);
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
});

/**
 * Plan 020: the hall is built through the same sliced generator, and the product's first press and every return from a run go through it, so what the boot
 * and a restart raise must be what the synchronous hook builds - the room, its dressing, its racks on their slots, its altar and its way down. Its own page: the
 * pooled one was booted past the hall (`?hall=skip`), and `dungeonTest.reset` returns a page to the mode it booted in.
 */
test.describe('the hall', () => {
  test.use({ hall: true, isolate: false });

  test('the hall built through the sliced path is identical to the synchronous one, racks, altar and way down included', async ({ game, page }) => {
    await game.setMeta({ ...freshMeta(), arms: ['tideblade', 'spear', 'maul'], arm: 'tideblade' });
    const capture = () =>
      page.evaluate(() => {
        const snapshot = JSON.parse((window as GameWindow).render_game_to_text!()) as Record<string, unknown>;
        const { floor, graphics, enemies, features, stair, racks, remaining, hall, hallProps } = snapshot;
        return { floor, graphics, enemies, features, stair, racks, remaining, hall, hallProps };
      });
    // The sliced path: `reset` rebuilds the mode the page booted in through `restart`, which in this mode is the hall.
    await page.evaluate(() => (window as GameWindow).dungeonTest!.reset());
    await game.built();
    const sliced = await capture();
    expect(sliced.hall, 'the reset did not rebuild the hall').toBe(true);
    expect((sliced.racks as unknown[]).length, 'the fixture needs racks in the hall for the comparison to cover them').toBe(2);
    // The synchronous reference.
    await page.evaluate(() => (window as GameWindow).dungeonTest!.buildHall());
    const unsliced = await capture();
    expect(sliced, 'the hall the staged build raised is not the hall the synchronous hook builds').toEqual(unsliced);
  });
});

/**
 * Plan 020, operator 2026-10-02: there is no LAST KEEP. Like SAME KEEP on the death card (D9), it was an instant
 * retry that skipped the hall, and as in Hades every attempt now leaves from the hall. A slot still remembers its last
 * seed (the run log replays it with `restart:<seed>`, and `start:<seed>` stays a command), so the precondition here is
 * that a seed really is stored: an empty slot would show no such button anyway, and the absence would prove nothing.
 *
 * This drives the plain URL rather than the `game` fixture, which passes `boot=eager` and `hall=skip`; the title
 * under test is the one a player sees, and pressing ENTER from it must land in the hall, not in the remembered keep.
 */
test.describe('with a keep remembered from a previous visit', () => {
  const remembered = 0x2468ace;
  test.use({
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://127.0.0.1:${process.env.GAME_TEST_PORT ?? 3000}`,
          localStorage: [{ name: 'drowned-keep:1:seed', value: String(remembered) }],
        },
      ],
    },
  });

  test('the title offers no LAST KEEP, and ENTER leads through the slots to the hall', async ({ page }) => {
    await pinSeeds(page, DEFAULT_SEEDS);
    await page.goto('/');
    const stored = await page.evaluate(() => localStorage.getItem('drowned-keep:1:seed'));
    expect(stored, 'precondition: slot 1 remembers a keep, or a missing LAST KEEP proves nothing').toBe(String(remembered));
    await expect(page.locator('.intro-screen .primary-action')).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Last keep' }), 'the title still offers LAST KEEP, a retry that skips the hall').toHaveCount(0);
    await enterKeep(page, 1);
    await expect(page.locator('.intro-screen')).toBeHidden({ timeout: WARM_UP });
    const state = await page.evaluate(
      () => JSON.parse((window as GameWindow).render_game_to_text!()) as { mode: string; hall: boolean; floor: { seed: number } },
    );
    expect(state.hall, 'ENTER did not lead to the hall').toBe(true);
    expect(state.floor.seed, 'ENTER entered the remembered keep instead of the hall').not.toBe(remembered);
  });
});

/**
 * The veil's bar is measured work, not a stage count: texture bands finished and shader programs linked,
 * weighted by how long each stage takes (`dungeon-veil.ts`). While a stage's name is up the bar is inside
 * that stage's share, it never runs backwards though the program list grows under it, and it is all but
 * full by the time the veil lifts. There is no "N / 5" any more: five stages of very unequal length made
 * a count that read 4 / 5 over a bar a little past half.
 */
test('the loading bar follows measured work, never runs backwards and ends full', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.intro-screen .primary-action')).toBeEnabled();
  await enterKeep(page);
  await expect(page.locator('.loading-veil')).toBeVisible();
  const samples = await page.evaluate(() => new Promise<{ stage: string; progress: number }[]>((done) => {
    const out: { stage: string; progress: number }[] = [];
    const sample = () => {
      const fill = document.querySelector<HTMLElement>('.loading-veil .veil-bar i');
      if (!fill) { done(out); return; }
      out.push({ stage: document.querySelector('.loading-veil .veil-stage')?.textContent ?? '', progress: Number(fill.dataset.progress ?? 0) });
      requestAnimationFrame(sample);
    };
    sample();
  }), undefined);
  expect(samples.length, 'the veil was sampled while it was up').toBeGreaterThan(0);
  let last = 0;
  for (const { stage, progress } of samples) {
    expect(stage, 'the stage line carries no count').not.toMatch(/\d\s*\/\s*\d/);
    const index = VEIL_STAGES.indexOf(stage as (typeof VEIL_STAGES)[number]);
    expect(index, `"${stage}" is a stage`).toBeGreaterThanOrEqual(0);
    // The last stage's name stays up once the build is done, so its ceiling is the full bar.
    const ceiling = index === VEIL_STAGES.length - 1 ? 1 : veilProgress(index + 1);
    expect(progress, `bar during "${stage}"`).toBeGreaterThanOrEqual(veilProgress(index) - 1e-3);
    expect(progress, `bar during "${stage}"`).toBeLessThanOrEqual(ceiling + 1e-3);
    expect(progress, 'the bar never runs backwards').toBeGreaterThanOrEqual(last);
    last = progress;
  }
  expect(last, 'the bar is all but full when the veil lifts').toBeGreaterThanOrEqual(veilProgress(4));
});
