# Liminal Found Footage · Baked Light — our demo

One example among many. Don't reuse its story, arc, shots, props or timings.

Demo: *Wing C* (60.7 s) · `test.mp4` · source in [`demo/`](demo/)

## Story & structure

A night caretaker films the motion-sensor lighting of a school wing. The lights switch on just ahead of the camera as it walks. Then they stop answering; behind the camera they click off one by one until it stands in the dark. Far down the corridor a panel strikes on, then the next, closer, faster, until the chain stops two panels away. One second of nothing. A sensor's red LED blinks in the dark panel ahead, then in the one directly overhead, and every light in the wing restrikes at once: the corridor is empty to the end. The same notice on the other wall has a fourth rule, taped on: *The sensors do not detect staff.* The lights go out again from the camera outward, a tide of dark following something away down the corridor. REC off.

The presence is never drawn: it exists only as switching light. That is the native move this version of the style adds (**The light answers**), and it only works because light now stays inside its room.

Arc: routine (lights answer the walk) → wrongness (they stop answering) → approach (the chain of strikes, accelerating) → silence → the red blink overhead → restrike, empty → the rule that explains it → the dark recedes.

## Shots

| Beat | Camera |
|---|---|
| Opening | Tape rolls in on black; the camcorder title types *WING C / NIGHT CHECK*; the first panel strikes over a notice; lens parallel to the page, notice in the upper two thirds so captions never cover it |
| Reveal | Pan right off the notice to the corridor as the next panel strikes |
| Routine | Walking POV; each panel ahead buzzes on ~4 m before the camera reaches it; glance down at the shoes on the vinyl tiles |
| Wrongness | The next panel doesn't strike; the camera stops at the edge of its dark pool; relays click off behind (heard, never seen) |
| Approach | Zoom 52° → 24°, autofocus hunting on empty lit stretches while 13 panels strike toward the camera at shrinking intervals (1.4 → 0.42 s) |
| Peak | Unzoom, held breath, digital silence; red LED blinks in the dark panel ahead; slow tilt up to the sensor overhead; everything restrikes, snap down |
| Rule | Turn right, crouch, push in on the second notice until the taped strip fills the frame |
| Ending | Turn back to the corridor and hold while the panels go out from the camera to the far end; REC off |

## Palette & props

- School corridor 3.0 m wide, 2.7 m ceiling, a single row of 0.6 × 1.2 m panels every 2.4 m (F0…F26), a PIR sensor dome with a red LED beside each. Classrooms both sides (7.0 × 7.2 m, one doorway each, six panels, a chalkboard, three black night windows). Past −76 m the corridor runs on unbaked into the fog.
- Walls `#b9c49a` above a `#6f7f66` locker band (0.38 m doors, vents, handles), rubber cove base; vinyl tiles `#a89a7d` 30 cm with replacement tiles and a darker border course; ceiling tiles `#d8d6c4` with stains and one missing tile.
- Signal colour: the sensor LED red, a dot driven to bloom (×16).
- Notices: photocopied facilities sheet, IBM Plex Sans Condensed; the second copy has rule 4 printed later on a strip taped over the footer.

## Light (the change this style makes)

- 28 light-style layers: F0…F26 one each, all classrooms one. Baked in 10 passes of three + one chroma pass, for three surface sets: walls (one `unwrapUVs` atlas, 1536², padding 4), floor and ceiling (plan maps, 1024², the 18 × 76 m plan folded into two 18 × 38 m strips).
- Direct: each panel is 8 sub-points (2 × 4); visibility from a 2048-direction polar shadow map per sub-point, filtered over 3 directions. Bounce: 64 virtual lights per panel placed where its cosine-weighted rays land (floor or wall), power = flux × albedo / 64 × 1.35, each with a 1024-direction polar map. Each texel visits only the panels that can reach it; spp 8 cycles every sub-point and every virtual light exactly once, so the bake has no noise.
- Panel radiance 10 (floor under a panel ≈ 1.0). Strike curve: tick 0.18 → dark → tick 0.3 → buzzing flicker → 0.88 at 0.62 s → 1.0 over ~1.2 s. Switch-off: 1 → 0.15 in 50 ms, then a 0.12 s afterglow.
- Gloss: vinyl floor reflects the three nearest corridor panels (and a classroom's six inside it) with a representative-point highlight (exponents 900 and 60), weighted by that panel's layer at the fragment and by Fresnel.
- Auto exposure from the light near the camera, lagged 0.45 s; AGC gain rises as exposure opens.

## Score structure

No score. The rhythm is the relays: strikes every ~1.8 s on the walk, four clicks off behind, 13 strikes accelerating 1.4 → 0.42 s, digital silence, the LED tick, the restrike thunk, 21 clacks receding. Hum driven by the same layer curves as the picture (50 Hz light track in `events.json`), room tone, a brown-noise drone from the far strikes to the silence, vinyl steps, cloth, breath, camcorder clack, motor, zoom servo, AF ticks.

## Build notes

```
demo/
  world.js      layout, fixtures, sensors, layers, geometry (shared by bake and film)
  light2d.js    plan-view polar shadow maps and virtual point lights (CPU)
  bake/         index.html + bake.js: r187 WebGPURenderer (forceWebGL), unwrapUVs, LightMapper, readback
  tools/bake.mjs  runs the bake page, writes lm/*.bin + manifest.json
  look.js       materials reading the layer maps, fog, floor gloss, panels, sensors, moving objects
  tex.js        notices and the panel diffuser      figures.js  the operator's shoes
  story.js      timeline: camera, layer curves, LEDs, captions      main.js  renderer, post, VHS, OSD, events
  vhs.js, osd.js  camcorder pass and bitmap OSD (from the base demo)      mix.py  all sound
  build.sh      one command: bake (once) → events → mix → frames → mux → srt → poster
```

`sh demo/build.sh` with `LIB=` the library folder and `OUT=` a build folder inside the library (default `$LIB/films/wing-c-build`): it copies `demo/` there and builds the copy. `QUICK=1` is a few-minute smoke test (small bake, events, mix, three stills). On a 4-core machine without a GPU (SwiftShader): bake 18 min, frames 49.5 min with 4 workers (~7 s per frame per worker), mix 30 s.

### Pitfalls we hit

- The first bake shader looped over all 123 panels per texel: hours on CPU. Visiting only the panels that can reach a texel (3 per corridor pass, the texel's own room or the three nearest rooms each side) made it ~70 s per pass.
- Maps read back from the WebGL2 backend come out flipped in v: sample at `(u, 1 − v)`.
- `unwrapUVs` replaces each mesh's geometry (vertices split at chart seams), so the film can't rebuild it: the bake exports the unwrapped geometry and the film loads it.
- A notice framed too close fills the frame and ends under the caption: keep it in the upper two thirds.
- The canvas silently fell back to a serif because a font weight wasn't preloaded: `document.fonts.load` every weight the notices use.
- `tools/bake.mjs` finished but never exited (the library's page server keeps Node's event loop alive): end it with `process.exit(0)`.
- With raw dynamics (LRA 19.5) ffmpeg's two-pass `loudnorm` silently drops to dynamic mode and rides the gain, lifting the near-silences: `mix.py` rides the faders by scene so the final pass stays linear (LRA ≤ 11).
- Tape noise at 1080p is expensive: the −14 LUFS master at CRF 19 is 231 MB for 61 s; re-encoded at CRF 28 it is 64 MB and the grain survives.
- Exposure: the camcorder AE is driven by the light near the camera; bright close-ups (the notices, the lit floor at the feet) need a hand-keyed trim (`EXPO` in story.js) or the paper blooms over its own text.
