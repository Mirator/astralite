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
