# Art direction

## The rule

Colour tells you what kind of thing you are looking at. It cannot tell you how
many frames you have left. Anything the player must answer on a deadline is
carried by a hard edge closing on a clock, drawn above the tone-mapped range.

Four things follow.

1. Each family commits to a palette. Not a tint over shared stone. A different
   place.
2. What is burning is the identity. The light source is the most saturated
   thing in the frame and it names the area before any wall does.
3. The field stays dark and quiet, and it stays under the figures standing on
   it. Paving low in value, and the carved work under the paving, so nothing
   the player has to read competes with the architecture around it.
4. Urgency is a converging shape in one hot red, the same red in every family,
   winning on hardness and brightness rather than on hue.

## The families

`ROOM_MOOD` in `dungeon-art.ts` is the whole palette, and the frame reads it
per chamber rather than per floor: key, sky and ground light, fog, backdrop,
paving, coursework, carved work, the medallion bed, the cloth, and what burns.

```
  keep: {          // the standing keep. Cold, dry, high, lit by witchfire
    key: 0xd1dce5, sky: 0x7a97b8, ground: 0x121721,
    fog: 0x0a111a, background: 0x0f1a29,
    tile: 0x485670, border: 0x344055, block: 0x3d495c, foundation: 0x1f2737, seal: 0x72a5ca,
    fire: 0xa870e6, banner: 0x3a5c88, masonry: 0x475366,
  },
  ruins: {         // the collapsed outer works. Warm, dusty, lit by real flame
    key: 0xe3d8c9, sky: 0xa98560, ground: 0x221811,
    fog: 0x1b1009, background: 0x2a1a0f,
    tile: 0x5e4f3a, border: 0x453a2a, block: 0x5a4d3a, foundation: 0x352a1d, seal: 0xc4a164,
    fire: 0xff913d, banner: 0x345865, masonry: 0x665842,
  },
  flooded: {       // the drowned levels. Cold, wet, lit by what grows there
    key: 0xccdde1, sky: 0x69a2ab, ground: 0x0f1c1f,
    fog: 0x081417, background: 0x0d2126,
    tile: 0x3c5e62, border: 0x2b474a, block: 0x365054, foundation: 0x192b2e, seal: 0x5cb3bc,
    fire: 0x18c9dc, banner: 0x428a7b, masonry: 0x405a5e,
  },
```

Fire is the field that makes a family a place. It drives the four torch point
lights, the flame bodies, their cores, the halo sprites, the ember motes and
the home colour `borrowedLight` returns the lent lamp to. Two of the three burn
off amber, which is what leaves hot red free for the tell everywhere.

The key lights carry less chroma than the paving does, which is the opposite of
where they started. An ambient that is already tinted stops a lit pool reading
as a pool; it reads as a brighter patch of an already-coloured room. Fire
carries the hue now, so the key does not have to.

Carved work sits under the paving. Columns, cornices, archivolts, parapets,
footings and the bowls fire sits in take `masonry`, and `pale`, the variant a
standing column reads against its wall with, is darker than `masonry` rather
than lighter. A lift was the lazy way to buy that separation and it put cap
stones and lit pillar faces above both the knight and the body winding up
beside him, which are the two things in the frame that have to win.

## Signals

The same in all three families, and no chamber may take any of them.

| Role | Colour | Form |
| --- | --- | --- |
| Threat telegraph | `0xff4529` | hard-edged arc, converging, opaque, above range |
| Commit flash | `0xffd6c2` | one frame, on the mark and the body together |
| Restore | `0x71f4c4` | pulsing, ringed |
| Goal: stair, brass | `0xfbc956` | hard ring, vertical shaft |

Threat sits about twenty degrees off the ruins' own fire and has the other two
families to itself. The warm family is the hard case and it is won on hardness,
brightness and convergence rather than on hue.

## The tell

The mark reads as time remaining. It opens at 1.9 times the reach the blow
actually has and shuts onto the body over the tell, at constant opacity. There
is no opacity ramp: a fade says a blow is coming and never says when, which is
the whole of what this has to say.

**Opaque, not additive.** This is the one that has to be got right and the one
that looks wrong in the source until you have measured it. Additive means floor
plus red, so the paving's own green and blue survive underneath and set the
result: the same `0xff4529` measured out as dusty pink over the keep's violet
slate and muddy orange-brown over the flood's teal, which are precisely the two
families whose fire was moved off amber to make room for it. A mark whose
colour is decided by the room it is drawn in is not a signal. Full opacity, not
merely high: at .88 the mark topped out around 94 of a possible 100 while a
brazier core clipped at 100, and a signal carrying a deadline may not be dimmer
than the furniture.

**Two passes of one shape.** The solid pass keeps its depth test and belongs to
the world. A faint copy behind it at a third of the opacity does not, so a
plinth or a column standing between the lens and the arc leaves a red ghost
rather than nothing. Drawing the whole arc through the world was tried and is
worse: a hot arc over solid stone makes the stone look like glass.

**Two channels.** The body takes the threat colour during a windup and rides
the same clock, so a tell that loses part of its arc has not lost its tell.

**One colour for all three kinds.** Shape carries the archetype, the stalker's
long lane against the others' arc, and so do the eye hues. Those are a good use
of colour and they stay, with the stalker's moved off red: three hex units from
the telegraph meant a body standing still wore the colour that means a blow is
landing.

## Enemy silhouettes

Colour names the family of a body; shape names its kind. From a camera forty
degrees up, a figure's shape is mostly its upward faces, so each kind puts its
archetype there (plan 011).

**Guard.** The one thing that says "skeleton" is the face, and a full helmet
covered it. The guard wears an open cap on the crown and back of the skull, so
brow, sockets and jaw show from any three-quarter view. His sword is a flat iron
blade with its broad face up, which reads by width rather than value; it stays
dark, because a long pale blade is the knight's. A brass rim makes the shield a
ring rather than eight dots.

**Stalker.** Its whole threat is the long lane, so its hands are the silhouette:
three bone claws per hand, longer and fanned, in front of the body. They stay
within five hundredths of their old reach, because the lane was sized to the
old arm. What makes it low is its pose, which these shapes do not change.

**Warden.** Heavy and crowned, and armoured as one mass: stepped iron faulds
carry the plate down over the hips, where a pale pelvis box used to show under
a black slab, and a gold edge runs along the breastplate's top. Bone shows at
the limbs and the skull only. His bone value and plate hue stay where the
separation measurements put them (see `makeSkeleton`).

## What is measured

`tests/browser/art-direction.spec.ts` settles the claims above off the rendered
canvas in CIE Lab rather than off the constants. What a tell is worth on screen
is what survives the key, the fog, the weathering shader and ACES, and none of
those are visible from a palette table.

For the tell it draws each chamber twice, once with the body at rest and once
at the top of its tell, and differences the frames. The pixels the mark covers
are exactly the pixels that changed, so nothing has to know where the decal
landed. It asserts the mark is a mean ΔE of 25 from the stone under it and that
the mark's own core is within eighteen degrees of `THREAT` at chroma 45 in
every family, which is the regression guard for the additive fault.

For the fire it takes the top half per cent of the frame by chroma and asks
what colour that is. An earlier version compared the three constants in
`ROOM_MOOD` and called it measured, which proves only that three numbers
differ: it passed comfortably through a round in which four fifths of the
bright pixels in both cold chambers were rendering under a quarter saturation,
because an additive halo sprite sat over the whole flame and washed it. The
constants were fine and the frames were not. What a family is lit by is a
question about pixels.

It also holds each chamber's ninetieth percentile of lightness inside a band. A
band rather than a floor, because the third rule has no lower bound written into
it anywhere and three successive rounds of honouring it took that figure from
the mid forties to the low thirties, one step at a time, with nothing watching.
Dark is the point. Unlit is a different game, and the difference between them is
worth a number.

## Floor motifs

Every room used to carve the same 16-point compass into its own medallion bed —
one decoration standing in for eight rooms of theme. `dungeon-decor-layout.ts`
plans at most one motif per room (`planFloorMotifs`/`planRoomMotif`) and
`dungeon-floor-motifs.ts` builds it (`buildFloorMotifs`); `dungeon-art.ts` wires
the two into `addCarvedArchitecture` in place of the old disk, rings, star and
ticks. The three constructions differ by shape, not by a new colour on shared
stone — `dark`, `inlay` and `lip` are exactly the materials the old compass
used, unchanged.

| Theme | Construction |
| --- | --- |
| keep | A solid octagonal bed with a broad shield cut into its centre and a hairline splitting it; the octagon's own outer edge is traced in `lip`, complete in one variant and missing one edge in the other. |
| ruins | Three of the octagon's four quadrants survive as separated sectors — the fourth is gone entirely, not merely thinned — each edged in `lip` where it was cut and carrying one broken chevron near its outer face. |
| flooded | Three parallel channels in `dark`, no disk at all, crossed by two narrow `lip` bars. |

A room's seed and id pick a quarter-turn orientation and one of two variants
per theme; nothing here consumes the floor generator's own randomness. A
gauntlet and the goal room never carry one — the first reserves its whole
floor for the fight, the second for its stair seal. A sanctuary keeps a
1.6-unit radius clear at its centre for the shrine; a `keep` sanctuary gets no
motif at all, since a solid shield has no fragment that can hold a hole
without becoming something else, while `ruins` and `flooded` build their
sectors and channels around the clear circle directly, rather than drawing
the ordinary construction and cutting a hole in it. Existing seal rings and
shrine markers are untouched — they say what a room is doing, and stay
separate from what its floor looks like when nothing is.

## Flame silhouettes

Every brazier used to burn the same octahedron, scaled and spun the same way, whatever family it
stood in — one flame shape doing three jobs. `dungeon-flame.ts` builds three theme-owned bodies
(`createFlameGeometry`) and a pure `flamePose` that animates each on its own clock; `dungeon-atmosphere.ts`
resolves a brazier's theme from the room it belongs to (`floor.rooms[prop.room].theme`, never the
current chamber's fire colour) and keeps the same two meshes — body and core — the same halo, and
the same six ember slots every family always had.

| Theme | Silhouette | Motion |
| --- | --- | --- |
| keep | One narrow, asymmetric diamond, tip leaning off true, suspended above the bowl. | Slow vertical breathing and a small bob at 0.65 Hz; no rotation. |
| ruins | Two closed tetrahedra sharing one mesh — a taller tongue and a shorter one at 65% of its height, standing apart rather than merged into one spike. | Height varies at mixed 1.7/2.9 Hz and the tip sways sideways; irregular-looking, fully deterministic. |
| flooded | A low, broad, faceted bud with an off-centre peak — the ring dominates, there is no tall tip. | Width and height breathe slowly at 0.45 Hz; no vertical shooting, no rotation. |

Several things a first pass at this got wrong, none visible from the geometry's own numbers - only
from a rendered capture, and one of those only from a capture with the halo and rim stripped back
out to isolate what the body mesh itself was actually drawing.

The one that mattered: `ruins`'s two tongues are built as two independent tetrahedra merged into one
`BufferGeometry`, and the shared builder that winds every flame's faces outward decided "outward" by
testing a face's normal against the vector from the *global origin* to that face's centroid. That is
correct for `keep` and `flooded`, which really are single shapes centred on the origin, but wrong for
either of `ruins`'s tongues on its own, since each sits well off to one side. For the shorter tongue
in particular, the faces on its near side - facing back toward the taller one, which is exactly the
side the camera needed - had a true outward direction that disagreed with "away from the origin",
and got their winding flipped backward and back-face-culled into nothing. A capture with the halo,
core and rim removed to isolate the raw body confirmed it directly: one tongue rendered, the other
did not exist on screen at all, not merely small or washed out. The fix winds each tongue outward
from its own vertex centroid instead of the shared origin (`windOutward`/`mergeSolids` in
`dungeon-flame.ts`), which is the only change that made a second tongue appear at all.

Two more only became visible once both tongues were actually rendering. A projection of both apexes
through the game's own fixed camera (matched to `dungeon-game.tsx`'s position, lookAt and frustum)
showed the first surviving attempt separating by roughly 5px on a 1000-wide canvas against tongues
5-8px wide apiece - less gap than either tongue's own width, and a captured frame duly showed them
fused. Re-splitting the 0.50 width budget toward separation (0.51 apart) rather than radius
(0.065/0.048, down from 0.105/0.075) opened a ~15px gap against ~4-5px tongues at the same camera -
enough of a valley to read as two shapes rather than one uneven one. And the existing halo, sized to
match `keep`'s or `flooded`'s single peak (2.6 x 2.7), was several times wider than the whole
twin-tongue body and filled in exactly that gap with its own additive glow; `ruins`'s halo shrinks
well past a cosmetic trim, to 1.5 x 1.7, so the body's own shape carries the read instead of the glow
smoothing over it.

Two smaller things, also caught by capture: giving every source a small random static yaw (so two
braziers of the same theme would not look stamped from one another) fought the separation above -
a random turn just as often points the tongues' shared axis at the camera edge-on. Sources no longer
carry a static rotation; the per-source phase still desyncs each one's breathing and sway, which is
the desync the brief actually asked for. And a core built by uniformly scaling the body's own
geometry toward its shared origin pulls both peaks toward each other by the same factor - at core
size that alone would have reintroduced the single-spike read even with the winding fixed - so
`ruins`'s core keeps both tongues at the body's own x position and shrinks only their own height and
radius, a deliberate, documented exception to the otherwise-universal "core is 45-55% of body width"
rule (see the comments on `ruinsFlame` and `windOutward` in `dungeon-flame.ts`).

## Macro paving

Every stone floor used to repeat the same 1.43-unit slab on a perfectly regular grid, at every
scale — a texture at close range and, from across a hall, a visible rank-and-file of identical
squares nothing in the room ever broke. `dungeon-paving-layout.ts` plans, per room, a bounded set of
merged two-cell slabs and settled, staggered strips (`planPavingPatches`); `dungeon-paving-patches.ts`
builds the merged slab's own geometry (`pavingPatchGeometry`); `dungeon-game.tsx` wires both into the
existing paving batches in place of the ordinary top on exactly the cells they claim, leaving every
foundation, every groove/dish damage variant elsewhere, and every existing weathering rule untouched.

| Theme | Long-slab arrangement | Settled treatment |
| --- | --- | --- |
| keep | Short courses following the room's own long axis, close to its centreline | One sparse edge patch, ~5% of the room's eligible singles |
| ruins | Two or three offset clusters, scattered rather than centred, alternating orientation | Up to 12% of eligible singles, in staggered strips near the room's edges |
| flooded | Pairs pulled toward the room's edges rather than its heart, reading as broken channels | ~8% of eligible singles, in one shallow strip |

Coverage is bounded rather than decorative noise: at most 35% of a room's own stone cells may be
claimed by a pair, and every candidate cell is checked against `dungeon-decor-layout.ts`'s
`decorReservations` (with a conservative margin) before it is ever offered to the planner, so a
motif's bed, a shrine's clear centre, the weapon drop and a gauntlet's whole floor are never touched
— a gauntlet's entire footprint is one such reservation, which is why it never receives a patch. Nor
does a settled single ever share a cell with the per-tile `dish`/`groove`/`settled` damage roll
`dungeon-art.ts` already made: a cell the planner claims is forced to an ordinary top and the new,
shallower settle transform, so the two mechanisms never stack into a single tile sunk twice.

A merged slab is not two tiles glued together with the joint still modelled — it is one continuous
eighteen-triangle top with the joint's own rim and skirt built only on its true outer edge, at the
same physical bevel (`TOP`/`BASE`/`LIP`) every ordinary slab uses, so a pair reads as a longer stone
actually quarried that way rather than as a texture trick. The two cells' own `slabTint` values are
blended for the merged slab's colour, and the whole rectangle is mapped over one UV space rather than
the single-tile mapping repeated twice, which is what stops the existing edge-shaded stone texture
painting a false seam down the middle.

## Local actor cutaway

The fixed isometric camera means near architecture — a foreground pillar, a buttress, a gate span —
can stand directly between the lens and an actor who has simply walked (or lunged) behind it, with
nothing telling the player where the fight went. `dungeon-occlusion.ts` opens a small, camera-facing
dithered hole in the actual stone rather than adding a permanent through-wall outline: the obstruction
stays real architecture everywhere else in the frame, and the window only exists where and while an
actor's own body needs it.

Up to three fixed slots — the player, then at most two nearest awake, alive, in-room enemies within
four world units, and only while one is winding up or in the instant its blow releases — each carry a
small elliptical window (0.65–1.35 world units of radius depending on who owns it) centred on that
body. A vertex/fragment shader hook installed after `weatherStone`'s own (never before it, never
redeclaring `stoneWorld`) discards a fragment only when it sits inside that ellipse, in front of the
target by 0.10–6.0 world units, and above knee height — a 4×4 Bayer dither caps the removal at 90% so
the edge reads as broken stone rather than a clean cut, and overlapping targets combine by maximum,
never by summing past that cap. Enemy windows fade in over 0.10s and out over 0.16s; death, a hidden
state or a room change clears one at once instead. Only opaque pillar shafts/caps, high wall masonry
and carved gate spans are ever tagged eligible (`userData.cameraOccluder`, set once at creation, never
inferred from colour or class) — floor tops, foundations, water, cloth, foliage, flame, pickups,
characters and telegraphs never are, and shadows, depth and every other material property are
untouched.

## Surface index (presentation only)

`dungeon-surface.ts` is a pure, three.js-free module: `buildSurfaceIndex` bins every upward-facing
triangle from the floor's own walking surfaces — paving tops, merged slabs, wood planks, floor
motifs, all tagged `userData.walkingSurface` where they are built — into the grid cell it falls in,
and `sampleSurface` returns the highest such face under a world point, or `null` for a genuine gap.
`dungeon-game.tsx` rebuilds this once per floor, after everything that could tag a surface exists,
strictly for later presentation use (plan 008's footstep feedback reads it); collision continues to
use `floor.cells`/`canStand` exactly as before, and nothing here is ever consulted for whether a
position is legal to stand on.

## Footstep feedback

A planted boot says what it landed on, quietly. `dungeon-footstep-rules.ts` decides when a foot lands
— the exact `floor((phase + PI/2) / PI)` crossing the step sound already plays on, so a wall, a dash,
a hit-stop or a pause can never plant one — and which leg (the one `playerRunPose` has at full forward
extension). The support is `sampleSurface` on the realized floor above, never a flat plane and never
the global mood: the tile's own theme, the owning room's or else the nearest chamber's, the rule the
paving itself was coloured by.

| Surface | Per contact | Size | Life | Behaviour |
| --- | --- | --- | --- | --- |
| keep stone | 1–2 cool-gray flecks | 0.07–0.08 diameter | 0.20–0.25 s | low sideways spread, ≤ 0.10 high |
| ruins stone | 2–3 muted ochre-gray flecks | 0.10–0.12 diameter | 0.24–0.32 s | brief low puff, ≤ 0.16 high |
| flooded stone | 2–3 gray-cyan drops | 0.032–0.035 × 0.07–0.075 | 0.18–0.24 s | short ballistic flick, apex ≤ 0.15, gone on landing |
| wood, seam, no support | nothing | — | — | no dust off a bridge, no invented splinters |

Flooded means wet boots, not wading: the sea is three units below the walkway and is never touched, and
there are no ripples on solid paving. Dust and drops are born at the rim of the sole — the first on the
rim point facing the lens, since the sole's centre is inside the boot mesh itself — stay within 0.35 of
the contact and under ankle height, use normal blending at a start alpha of 0.19–0.22 (drops
0.26–0.30), and fade to nothing. Reduced motion keeps one fleck or drop, 0.12 s, under 0.03 of travel.

`dungeon-footsteps.ts` is one pre-allocated batch: 32 camera-facing quads in one geometry and one
material, a procedural soft mask instead of a texture, live quads compacted into the draw range and the
mesh switched off when empty — zero draws with nothing alive, one while anything is. It ages on
simulation time, so hit-stop and pause hold it still, unlike the hit accents, which age on wall time.

Measured, not assumed: at these sizes a fleck is two to six pixels on a 1000×700 frame (≈48 px per
world unit) and changes a few dozen pixels per contact at most. It anchors the boot rather than
decorating the frame — and at the ceiling of this table it is close to the threshold of what reads at
native size. Anything louder is a change to this table, made deliberately.

## The knight from above

Plan 010. At forty degrees down most of the knight's pixels are upward faces, and the helmet and the
top pauldron plate were the same steel, so from above he was one pale block. The top plate is iron now
and the helmet is scaled 1.15 about the neck (1.18 put his height 0.09 over where it was), so the
helmet is the one light mass over dark shoulders with the brass rim between them; the face tips 0.2
rad up towards the lens, trim and all. `steel` itself is untouched. Measured on the knight's own
pixels in the eight-facing strip (`tests/browser/figure-mask.ts`: each facing drawn with and without
him), the head's median L* over the shoulders' went from a median of 12.7 to 21.7 across the facings,
and clears 8 in five of them. The three facings looking at his back are still led by the cape, whose
red is brighter than the back of the helmet; that is the cape's value, and the cape was out of reach.
A red mantle over the shoulders was tried at every size the plan allowed and drew one pixel in eight
frames, because the pauldrons, the helmet and the cape's top edge cover that whole region, so it was
taken out. Red was already on him at every facing through the crest.

Plan 013 moved him towards the turnaround sheet in `docs/reference/knight-turnaround.webp` without
moving any of those numbers the wrong way. The sheet's knight is black plate with gold at every edge,
and taken literally that is exactly the one dark block plan 010 fixed, so the translation keeps the
helm as the palest mass and spends gold only where it does not sit in the shoulders' third of the
frame from above: a gold cross on the face, a gold rim behind the breastplate, a gold-bordered tabard,
thin rims on dark domed pauldrons. Gold edges on the shoulder lames and a steel elbow were tried and
each cost head-over-shoulders from the side. The plume is its own, brighter crimson so the top third
stays light, and it lies back rather than standing up, because the height is held and the legs needed
what it gave up.

## What is still shared

Named rather than hidden. The sea, the foliage, the spray and the motes carry
one value across all three families. The sea is the largest of them and the
most arguable: a cold tide around a warm ruin is what a coast actually looks
like, and it is also a quarter of that frame agreeing with neither the room nor
its fire.

Two chamber colours sit inside a signal's hue band, by the same argument made
above for threat against the ruins' own fire, and they are written down here so
that the argument is made rather than assumed. The ruins' `seal` is a couple of
degrees off the goal's brass and is separated from it by value, by chroma, by
opacity and by not being a hard ring. The flood's `banner` is a dozen degrees
off restore and is cloth on a wall rather than a pulsing mark on the floor. Both
are decor, and decor is allowed a beat that a deadline is not.

The HUD is chrome rather than keep. It has lost its glass panel, its blur, the
four stacked layers of `.hud` overrides that each undid most of the one above
it, and the Unicode heart that was the one glyph in the game borrowed from a web
page; `globals.css` names the four channels as tokens, which is what stops the
vitality bar drifting back out of red into the braziers' own orange, and the
vitality mark is now the same rotated square the title sigil is cut from. What
is left is still flat rectangles and mono digits. The permanent vitality bar is
also the one standing exception to the rule that no chamber may take a signal
colour, because it is drawn in the deadline red by declaration.
