# Astralite — The Drowned Keep

![Visual reference for the world, atmosphere, environments, combat readability, and roguelite progression](docs/reference/dungeons-beyond-concept.png)

> **Reference note:** The image above is a mood and art-direction reference, not a screenshot or a literal feature specification. It captures the desired readable isometric composition, ruined environments, dramatic lighting, clear combat silhouettes, and compact roguelite fantasy. The current game has its own drowned-fortress identity and focuses on melee combat rather than every character, weapon, biome, or feature shown in the reference.

## Overview

**Astralite — The Drowned Keep** is a compact isometric action roguelite played in the browser. The player is a lone knight descending through a flooded fortress whose chambers, doors, encounters, and landmarks are rebuilt for every run.

The experience is designed around a simple promise: **explore, fight, grow stronger, and go deeper**. Controls are intentionally small in number, but timing, positioning, enemy tells, the choice of which door to take, hazards, and temporary upgrades give each descent shape. A complete run spans three floors and can be finished in one focused session.

## Core loop

1. Enter a newly generated floor. On the first floor you begin in the Tide Gate, where every arm you have unlocked stands on a rack; take up the one you want with the swap key. The first door you take out of the Tide Gate locks that arm for the descent.
2. Clear the chamber you are in; its doors stay sealed until it is quiet.
3. Fight skeleton guards, evade stalker pounces, and break through wardens.
4. Choose a door with the swap key. Each door shows what waits behind it (a fight, a shrine, a mending, or a purse of experience), and every door leads one layer closer to the stair.
5. Earn experience from enemies and from purse chambers, and recover vitality from cleared chambers, and more from mending chambers.
6. Rank up and choose boons that improve the current run.
7. Defeat the wardens guarding the exit. Their fall unseals the stair; stand on it and take it with the swap key to review the floor results and descend.
8. Escape after three floors—or fall. Either way the run pays out pearls. Spend them at the Tide Altar, then begin a new descent or retry the same keep seed.

## The Drowned Keep

Each floor is a seeded chain of sealed chambers rather than a fixed sequence of arenas. It contains roughly 14–30 chambers assembled from several footprints, each its own island. There are no corridors, bridges, or dead ends: the only way between two chambers is a door on one of the two far walls, taken with the swap key once the chamber you stand in is cleared. Chambers stand in layers, from the Tide Gate through two or three chambers per layer to the stair hall, and every door leads exactly one layer on, so every path down is the same length. The choice is which door to take, because each door shows what the chamber behind it pays: a purse of experience, a mending, a quiet shrine, or a fight.

The keep mixes ruined stone halls, flooded passages, exposed coastal masonry, crypt-like chambers, wooden crossings, waterfalls, banners, braziers, broken walls, pillars, barrels, and scattered defensive remains. Animated tidal water, cloth, flame, embers, damp stone, torchlight, and cool exterior light give the procedural geometry a coherent sense of place.

Rooms are assigned encounter identities so exploration changes the immediate play pattern:

- **Watch rooms** present direct, readable combat.
- **Ambush rooms** wake hidden enemies after entry.
- **Gauntlets** place timed ember hazards across the arena.
- **Sanctuaries** contain a one-use healing shrine.
- **Warden chambers** block progress until their defenders fall.

## Combat and movement

Combat is deliberately built around three verbs: **strike**, **special**, and **dodge** (the dash). Every arm has its own special on a cooldown: the Tideblade lunges along the aim, the Twin Fangs vault a body and stab it in the back, the Salt Spear is thrown and drags its target back, the Warden's Cleaver whirls all the way round, the Bell Maul charges into a slam, the Keep Crossbow draws a piercing heavy bolt, and the Tideflask sets off every burning pool at once. Arms are chosen, not found: the racks of the Tide Gate on the first floor hold every arm you have unlocked, a rack is used with the swap key (the arm in your hand goes down on the rack you emptied), and no chamber deeper in the keep holds one. The first door out of the Tide Gate locks the arm for the descent, and the knight starts the next descent holding it. A new save owns only the Tideblade. Movement is screen-relative, attacks can be held to repeat, and a dash can abort a swing before or after the blade is live; while the blade is live, the dash waits for contact to end and then follows. The knight’s swing has anticipation, contact, and recovery phases, allowing attacks to feel responsive without losing visual clarity. A directional slash, hit-stop, particles, sound, recoil, and enemy health bars communicate impact.

Enemy behavior is meant to be learned at a glance:

- **Guards** close distance and pressure the player with basic melee attacks.
- **Stalkers** line up a visible long-range pounce that rewards sidestepping.
- **Wardens** are larger, tougher enemies with wider reach, stronger blows, and committed attacks.
- **Archers** hold their distance and loose bolts across the room (from floor two).
- **Shieldbearers** turn aside ordinary steel from the front; the shield is down while they wind up and recover, and a stagger arm, a flank or a backstab gets past it (from floor two).
- **Pyres** are frail, and the danger is where they die: the fire they leave bites anyone standing in it (from floor two).
- **Bonecallers** never strike; they hold back and call up rattlers, which stand up again as fast as they are cut down while the caller lives. Reach the caller, and everything it called falls with it (from floor three).

Enemy windups use visible cues, attacks require a clear path, and bodies keep enough separation to remain readable in groups. Damage briefly grants invulnerability, while hazards track their own flare cycle so overlapping threats remain consistent.

## Progression

Experience belongs to the current descent and resets when a new run begins. Defeated enemies and chambers that pay a purse of experience advance the player’s rank. Each rank offers a choice of boons, including improvements to strike strength, reach, dash distance, healing on kills, maximum vitality, and damage resistance.

What survives a descent is **pearls**. Every run, won or lost, banks pearls when it ends: one for each enemy felled (a bonecaller’s rattlers do not count), 15 for each floor left behind, and 25 for escaping, so even a death on the first floor pays a handful. Pearls are shown only in the menus and on the result card, never on the playfield. The result card’s **To the Gate** button returns to the title menu, where the **Tide Altar** is the one place pearls are spent: it unlocks the six arms beyond the Tideblade, in any order, and sells four small upgrades (Deep Lungs, Whetted Start, Keen Eye and Second Tide, which sets the knight back on his feet once a descent when a blow would kill him). Unlocking an arm does not equip it; the arm is chosen on the racks of the Tide Gate at the start of a descent. Everything together costs 900 pearls, about twenty typical runs, and the first two runs are enough for the cheapest arm and the first rank of Deep Lungs. The upgrades are small on purpose (Whetted Start is a quarter of a blade’s bite), because the keep is already easy for the balance bots: with every upgrade bought even the bot that never dodges escapes every run, so a difficulty pass comes next.

The game remembers the deepest descent, the seed of the current keep, settings, the pearls and purchases, and a local history of completed runs. Run records include outcome, floor, playtime, rank, experience, kills, boons, seed, cause of defeat, the arm carried, the upgrades held and the pearls earned. The result card at the end of a run reads from that record: it names what felled the knight, the time, and the boons taken, and a lost run offers a new descent or the same keep. The title menu has a **Copy run log** button that puts the finished-run records on the clipboard as JSON (or shows them in a box to copy by hand if the clipboard refuses), so a playtester can paste them to the developer; only the run records are included, no settings or device data. Otherwise this data stays in the browser and is not sent anywhere.

## Player experience

The permanent HUD stays intentionally minimal: vitality, the strike, special and dash icons (the special and the dash each with a cooldown sweep), and progress toward the next boon. Controls, journey statistics, settings, and the expanded floor map live in menus instead of competing with the playfield. Short room notices communicate meaningful events without turning objectives into a persistent overlay.

Keyboard and touch are first-class inputs. Keyboard bindings can be remapped, and touch supports either a continuous thumbstick or labelled direction buttons alongside separate dash, special, and strike controls. Volume, mute, fullscreen, and reduced-motion settings are saved locally. Reduced motion removes camera shake and animated hurt pulsing while preserving combat timing.

## Direction and design principles

The project’s established principles are:

- **Compact, replayable runs** rather than a long campaign.
- **Readable action** over mechanical clutter or excessive effects.
- **Meaningful procedural variation** through topology, encounters, hazards, and landmarks—not randomness alone.
- **A minimal HUD** with deeper information available on demand.
- **Atmosphere through motion, light, sound, and environment** while keeping silhouettes clear.
- **Fair rules and visible tells**, backed by deterministic gameplay and browser tests.
- **Simple controls with room for mastery** through positioning, timing, route choice, and boon combinations.

## Current form

Astralite is a single-player browser game built with React, Three.js, and TypeScript. Its current playable scope includes procedural three-floor runs of sealed chambers joined by reward doors, arm-based combat with a strike, a special, and a dodge, seven arms (six of them unlocked with pearls and chosen on the racks of the Tide Gate), a pearl economy and the Tide Altar that turns lost runs into upgrades, a bestiary of guards, stalkers, wardens, archers, shieldbearers, pyres, and bonecallers, multiple encounter types, hazards and shrines, run-specific boons, floor results, persistence of the best run, history and purchases, keyboard and multitouch controls, accessibility settings, audio, and deterministic test hooks used for automated playthroughs.

The reference image points toward the broader fantasy: an immediately readable adventure through varied, beautifully lit ruins where every new route feels like another story hidden beneath the waterline.
