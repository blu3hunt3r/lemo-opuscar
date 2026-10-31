# Documentary Parallax — our demo

One example among many. Don't reuse its story, arc, shots, photographs or timings.

Demo: *Endurance* (35 s) · `test.mp4` · source in [`demo/`](demo/)

## Story & structure

Shackleton's *Endurance* (1914–16) in 35 s, no voice, eight beats, nine handovers that never repeat. Darkness, then one blinding flash: Hurley's night photograph of the ship frozen into the Weddell Sea burns into view (he fired 25 charges of flash powder at once), title **ENDURANCE**. A flash cut to his real 1915 colour plate of the ship trapped in the pack: **281** days locked in the ice. The plate cracks like ice and shatters into the wreck: "The ice *crushed* her." A snow gust into the first reconstruction: from the camp a mile and a half away, the stern rises and she dives, "She's *going*, boys!" A blizzard (five months pass) clears on the launch of the James Caird, the surf running: "Six men. One small *boat*." Spray into the second reconstruction: the lifeboat at night, a pale line of "clear sky" that becomes the crest of an enormous wave: "Not clearing sky. A *wave*." The wave breaks into white and clears on a desk under a lamp: the 1919 map from *South*, the route drawn in red ink over its printed "Boat Journey" while **1,300 KM** counts; one real silence; the camera crosses the desk to the New-York Tribune of 4 September 1916 and a red pen underlines *Marooned*. The paper's white becomes the beach on Elephant Island, the sea moving: **28** · "men. Every one *lived*."

Arc: the picture → the time → the turn → the loss → the gamble → the peak → the record → the outcome. §11's "One event, told fast", at the upper end of its length.

## Shots

| t (s) | Scene | Source | Camera / motion |
|---|---|---|---|
| 0–3.9 | Flash | Hurley's night photograph (LoC), 3 bands | push 2.4 m (30 % of its 8 m near distance) through the ice toward the ship; one burst at 0.6 s; spindrift |
| 3.9–6.95 | Colour | Hurley's Paget colour plate ON 26/16 (SLNSW), 3 bands | drift left 0.6 m and push 1.8 m: the ice wall in the foreground slides away; low mist |
| 6.95–7.9 | Ice-crack shatter | the colour plate's frame | cracks race out from an impact point (0.32 s), up to 44 shards tip and fall toward the lens (0.62 s) |
| 7.9–10.7 | Crushed | "The End" (LoC), 3 bands | rise from the dogs to the broken masts (shift lens 0.61 of the print, camera up 0.5 m, push 1 m) |
| 10.7–14.5 | She's going (RECONSTRUCTION) | 3D, `scenes/sinking/` | long lens (9.6° → 8.5°) from the camp, slow push; backlit men in the foreground |
| 14.5–17.8 | Launch | "Launching the James Caird" (LoC), 3 bands, surf flowing | push 1.45 m toward the boat |
| 17.8–23.0 | The wave (RECONSTRUCTION) | 3D, `scenes/wave/` | low chase off the port quarter riding the swell, horizon tilting, fov widening 40° → 54° |
| 23.0–30.2 | The record | the 1919 map and the 1916 newspaper on a code-built desk | over the map following the red ink, a hold, a slide across the desk, a push into the headline |
| 30.2–35 | The beach | Hurley's own lantern slide of the men waving on Elephant Island (SLNSW Slides 22/48), 3 bands, the near sea flowing | lateral drift 0.55 m with a 1.15 m push; fade 34.1–34.9 |

## Palette & type

- Photographs in their own tones with a split tone (cool shadows, warm highlights); the colour plate in its real colour (Adobe RGB master converted to sRGB); the reconstructions in the palette of their hour: a low gold sun over steel-blue ice, a steel-blue night sea with a glowing crest; the desk warm under its lamp.
- One red: the caret, the red words (*crushed*, *going*, *boat*, *wave*, *lived*), the ink route, the underline under *Marooned*.
- White type with a dark shadow on dark pictures and skies; ink type with a paper halo on ice, snow, the overcast beach and the papers. A softer shadow behind red words.

## Depth layers (tools/layers.py, LaMa fill)

| Photo | Cuts | Notes |
|---|---|---|
| p1 (night) | by hand 0.16, 0.66, depth at 770 px | the automatic valley put the ship in the sky band at the higher depth resolution |
| colour2 (Paget) | automatic 0.24, 0.52 | sky and the distant ship, a strip of ice, the near ice and the wall |
| p3 (wreck) | by hand 0.14, 0.63 | wreck in the middle band; the dogs get their own |
| p5 (launch) | automatic 0.40, 0.87 | water mask: bright surf and sea, not the boat, men or rocks |
| p6_hi (beach, lantern slide) | automatic 0.164, 0.57, depth at 770 px | cropped inside the rounded slide mask; water mask on the near sea minus the rocks, flowing only in the two far bands so the men's edges stay still |

## The reconstructions

Built by two sub-scenes with the same contract (`build()` → `{ scene, cam, state(u) }`, a pure function of time): the sinking (procedural pack ice with pressure ridges, a 44 m mastless wreck that rises to ~75° and dives, four backlit figures, sleet, a low sun with an ice-crystal pillar) and the wave (12 Gerstner waves plus a travelling giant wave in one function shared by the GPU and the CPU, ~244 k vertices bunched under the crest, foam and spray, a 6.9 m iced lifeboat riding the same function). What rests on the record and what is invented: `RECONSTRUCTIONS.md`.

## Score structure

D minor to D major in low strings, horns, low brass, piano, timpani and bass drum (VSCO 2 CE, CC0; Salamander piano, CC BY 3.0); everything else synthesised. Night wind, then the flash burst; the score enters on the colour cut; a semitone lift as the ice shatters; a falling moan under the sinking; a spiccato pulse from the launch (16 beats so the wave lands on a downbeat); a tutti and a tam-tam as the wave breaks, cutting to room tone; the pen on the map; the score fully silent from 26.7 s until the red pen; D major with the horns when 28 lands.

## Build notes

```
demo/
  index.html, main.js   page contract, shift lens, transitions that draw two shots (the shatter)
  story.js              timeline: beats, flash, whiteouts, cameras, type, sound events
  engine/photo3d.js     a photo's depth bands as meshes, flowing water, depth mist, light level
  engine/atmos.js       snow / dust / spray in view space with per-particle depth of field
  engine/shatter.js     Voronoi shards textured with the outgoing frame; crack lines on the overlay
  engine/type.js        title, tag, story line (one red word), number (any easing); boxes for readcheck
  engine/post.js        MSAA → DoF gather → bloom → grade (split tone, lens fringing, whiteout in any colour)
  scenes/desk/          the desk, the lamp, the papers, the red ink
  scenes/sinking/, scenes/wave/   the two reconstructions
  scenes/_harness/      a page to develop one reconstruction alone (index.html.template: fill in SCENE, DURATION, U0)
  tools/layers.py       depth (Depth Anything V2 Small) → bands, LaMa inpainting, alpha, grids
  tools/flowmask.py, tools/papermap.py   water masks; the fallback paper map
  tools/frames.mjs      resumable frame rendering (180 s per frame; a second run renders only the missing frames)
  assets/raw/           the scans (SOURCES.md, SOURCES-v2.md), map_control.json, map_boatline.json
  FACTS.md, FACTS-v2.md, RECONSTRUCTIONS.md, CREDITS
  mix.py                score and sound from events.json
  film.sh               builds in place; build.sh copies demo/ to $OUT and runs film.sh there
```

`sh demo/build.sh` with `LIB=` the library folder and `OUT=` a build folder (default `$LIB/films/endurance-build`). It downloads three.js and the fonts from npm and the two models from Hugging Face, makes a Python venv, cuts the layers and masks, then events → mix → frames → mux → poster. `QUICK=1` stops after six stills. On a 4-core machine without a GPU (SwiftShader) the 840 frames take about 82 minutes with three workers (7–8 s a frame for one worker alone, 14–20 s each with three side by side, 45 s for the slowest); the photo layers about 10 minutes, the sound 25 s. A stopped render resumes: run `film.sh` again and only the missing frames are rendered, so a change to a few seconds is fixed by deleting those frames from `$OUT/frames` and running it again.

### Pitfalls we hit

- **The first version was too polite.** Six slow beats of soft grey scans, nothing moving inside the frames, one whiteout four times, a flat vector map: next to the references it read as a slideshow. The fixes were all in this list: real colour, moving water and light, bigger moves on inpainted fills, reconstructions for the missing moments, real documents on a desk, a new handover for every cut.
- **Check how a picture was made before you show it.** The first cut revealed the night photograph with four flashes in a row; Hurley fired 25 charges at once. One burst is both true and stronger.
- **Fog that ignores height** paints a grey slab across the sky; it only works low and thin, and not at all on a night flash photograph.
- **Reconstruction figures lit from the front look like toys.** Backlit near-black silhouettes with a soft warm rim, well out of focus, read as people.
- **Red type with a dark halo goes muddy on a bright sky**: red words get a lighter shadow.
- **A beat is as long as its words.** Lay the lines out against the reading rule before timing the shots; three beats grew by 0.3–0.5 s.
- **The render tool allows 30 s per frame, and one slow frame stops everything.** The first full render of this version stopped after 46 minutes on the shatter's first frame (two scenes, three workers on four cores). The shatter now renders the cracking photograph once, frozen at the impact, and the film renders with `tools/frames.mjs`, which allows 180 s per frame and resumes where it stopped.
- **A better scan can turn up late.** The beach was first cut from the Library of Congress copy negative (1536 px); Hurley's own lantern slide (2864 px, continuous tone) arrived during the render and replaced it. It is framed differently (more sky, the men lower), so the type was checked again on it, and it is shown as neutral black and white because an old stain on the slide is tinted yellow.
- **Moving water dragged the men's outlines**: the water mask was feathered into the people and the boat beside it. Pulling it back by its feather (`--inset 14`) and, on the beach, flowing only the two far bands fixed it.
- **A date can mislabel the next picture**: the newspaper's "4 SEPT 1916" was still fading as the beach appeared, as if it dated the beach photograph (whose date is disputed). Type is drawn above the whiteout, so a line still fading at the white peak floats on the white and seems to label what comes next: every line now leaves by the peak of its handover (the sinking's date became "21 NOV 1915" to keep its reading time).
