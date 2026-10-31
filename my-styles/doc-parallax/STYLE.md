# Documentary Parallax — Style Prompt

Made from a blank page; techniques from Archive Light Table (archive-lighttable) and Parallax Journey (the user's own style) in Lemo-Opuscar.

> Real public-domain archive photographs turned into slow, cinematic 3D scenes. Every photo is cut into depth layers with what hides behind its subjects filled in; the camera pushes and drifts inside it while weather and dust move through the air. What no camera saw is rebuilt in 3D and says so (RECONSTRUCTION). Scenes hand over through objects and weather (a flash, ice cracking, a whiteout, a photo printed in a newspaper, a map on a desk), and a bold editorial type system carries the facts with one word in red.
> References (grammar only): the "3D parallax" history-documentary look of contemporary YouTube channels, and the 2.5D photo animation of archival documentaries. Do not copy any channel's intro, branding, title cards, music or frames.

## 1. Essence, and what it is not

- **The pictures are real.** Every image is a public-domain (or CC0) archive photograph, a newspaper page or a map from an open collection, at its own tones, grain and damage. Nothing is generated, colourised, upscaled, retouched or re-staged, and nothing is painted into a photograph: only light, weather, water and the lens move over it. Where the period made real colour (autochromes, Paget plates), use it. A fact on screen comes from a source in `FACTS.md`.
- **What no camera saw is rebuilt, and says so.** A moment with no photograph (a sinking at dusk, a boat in a night storm) may be a 3D reconstruction built in code from the primary accounts, graded to sit beside the photographs and tagged **RECONSTRUCTION** in its date line; its notes (`RECONSTRUCTIONS.md`) list what rests on sources and what is invented. One or two per film, at the moments the record cannot show.
- **Each photograph is a place the camera enters.** A photo is split into 2–3 depth bands; each band is a surface in 3D shaped by estimated depth, with the area a nearer band hides filled in. The camera pushes, drifts and rises a little, so the photo opens up without tearing.
- **The air moves.** Snow, spray, smoke or dust drift at several depths in front of and behind the subjects, so a still photograph has weather.
- **One continuous telling.** Scenes hand over through objects and the medium itself (into a printed photo, a whiteout, a map), never by plain cuts or crossfades.
- **Editorial type.** Big titles, one serif line with one red word, numbers that land. Few words, held long enough to read.

Not AI imagery or "restored" archive (no generated, colourised or upscaled pictures; never stand a generated image in for an archive one), not a Ken Burns pan (a flat photo slid and zoomed has no depth), not Archive Light Table (no table, loupe, catalogue cards or measuring marks on objects), not a slideshow (no hard cuts or dissolves between photos, except the fade to black at the very end), not a trailer (no whooshing whip pans, no impacts on every cut).

## 2. Materials & rendering

- **Sources**: open collections with masters and records (Library of Congress incl. Chronicling America newspapers, NARA, Smithsonian Open Access, Wikimedia Commons files with a clear public-domain basis, national libraries' out-of-copyright collections). Public domain needs a reason that applies (e.g. taken before 1955 in Australia, published before 1931 in the US); "no known restrictions", CC BY-SA and rights-managed scans are not enough: name the terms and ask. Keep `SOURCES.md` (file, creator, date, holder, URL, licence and its evidence, size) and `FACTS.md` (claim, value, source URL, quoted wording).
- **Depth**: a monocular depth estimate (Depth Anything V2 Small, Apache-2.0, run offline on CPU by `tools/layers.py`), normalised to 0–1 disparity. **Cut it into 2–3 bands at valleys of its histogram** (or by hand where a subject straddles a valley). Band k keeps everything at least that near; its colour fills the area the next band covers (**LaMa inpainting**, Apache-2.0, in tiles sized to the hole, plus the photo's own grain; the membrane fill remains as a fallback); its alpha is feathered 2–4 px; its depth surface is extended smoothly past its edge so border vertices never stretch.
- **Geometry**: each band is a grid mesh (≈ 200 × 120 vertices) unprojected from the scene's start camera: vertex = ray(uv) × Z, with 1/Z interpolated in disparity between the photo's far and near distances (sky flat at the far distance). From the start camera the composite is the original photo exactly.
- **Moves stay inside the fill's tolerance**: with an inpainted fill, lateral travel ≤ 5 % of the near distance per second of screen time, dolly ≤ 30 % of the near distance over a shot, rotation ≤ 2° (with the membrane fill: 3 %, 20 %). Bigger moves show the fill. A tall print is framed with a **shift lens** (the projection centre moves, the camera does not turn), so a rise can travel the whole print while the camera itself stays within these limits.
- **Atmosphere**: billboard particles in 3D (snow, ice crystals, spray, smoke, dust) at 3–4 depths, soft, drifting with wind and gusts; particles in front of the focus plane go large and soft in the depth of field. Mist lives in the layers themselves (thicker with distance, drifting 3D noise, below a height so it never paints the sky).
- **Water moves**: in a photo's sea, surf or river, the scan flows (two copies sliding along a noisy flow field half a period apart, cross-faded) inside a mask that keeps people, boats and rocks still, and only in the bands that hold the water (a nearer band of people would pick up the motion at its edges). Small offsets (≤ 1 % of the frame per period).
- **Light the archive as it was lit**: a flash-powder photograph can be revealed by its flash, a lantern slide by its lamp; check how the picture was actually made (one burst or many) before showing it.
- **Lens and grade**: physical depth of field (focus on the subject band; the nearest band soft when the subject is mid-ground); halation on highlights (bloom, low strength); vignette; a cool shadow lift and warm highlights only as a grade, never a colour cast on the photo; fine moving grain at mux (grain 3–4). Gate weave ≤ 0.5 px and exposure flicker ≤ 2 % at most.
- **Maps**: a period map from the record (a public-domain atlas or book fold-out, georeferenced on its own printed graticule) lying on a desk under a lamp, the route traced in red ink over its printed line; or, when none exists, drawn by code from public-domain data (Natural Earth) in the paper tone of the film.
- **Documents on a desk**: newspapers, maps and prints are real scans on paper meshes (slight curl, folds) on a code-built desk with a lamp's warm light, soft shadows and dust in the beam; the camera reads across them with a shallow depth of field.
- **Reconstructions** are 3D scenes built in code (no downloaded models or textures), lit and graded to sit between the photographs: backlit silhouettes rather than faces, weather and distance doing the work.

## 3. Colour logic

- **The archive's own tones** carry the picture (silver greys of glass plates, paper tans of prints, newsprint). Grade them as a whole (shadow lift, highlight warmth, contrast, a **split tone**: cool shadows, warm highlights), never tint parts of them. Real colour plates keep their colour (converted to sRGB from the holder's profile). Reconstructions take the palette of their hour (steel-blue night storm, low gold sun) at restrained saturation.
- **One signal red** (e.g. `#d7322b`): the red word, a route line, a marker, the measuring ticks. Nothing else is saturated.
- **Type** takes the tone the picture leaves free: paper-white with a soft dark shadow over dark parts of a photo (a night sky, a coat, the sea on a map); ink black with a soft paper halo over light skies, snow and paper.
- Maps: land `#d8cfbd`, sea `#1c2228`, coast line `#8d8576`, route `#d7322b`.

## 4. Type & subtitles

Four roles, all OFL and self-hosted:

| Role | Use | Font | Size at 1080p |
|---|---|---|---|
| **Title** | the event's name, once | Inter 800, caps, tracking −1 % | 120–180 px |
| **Date / tag** | where and when, small facts | IBM Plex Mono 500 caps, tracking +12 % | 22–30 px |
| **Story line** | one sentence per scene, ≤ 7 words | Cormorant Garamond 500; the key word in red italic with a hand-drawn red underline | 56–84 px |
| **Number** | the figure that matters | Inter 800, counts up and lands; a serif caption under it | 140–220 px |

- Titles and dates type on (≈ 22 characters/s, a caret); story lines rise in word by word (0.08 s apart, 8 px rise, 0.35 s fade); the red underline draws after the red word lands; numbers count with an ease-out and land with a small settle.
- Placement: in the photo's calm area (sky, ice, shadow), never across a face or the subject; left-aligned on the left or right third; inside the 4:3 safe area.
- **Reading time**: ≥ characters ÷ 15 + 1.5 s fully on screen after the last word lands.
- **Leave before the handover**: type is drawn above the picture, whiteouts included, so a line must be gone by the white peak of its handover; one still fading there floats on the white and seems to label the next picture (a date over the wrong photograph).
- **Subtitles** (narrated films): a quiet sans line at the bottom centre (Inter 500, 38 px, soft shadow), exported as `.srt`; never repeat the on-screen line.

## 5. Motion quality

- 24 fps on ones; the camera moves on smooth monotone curves, slow in and out, **always moving** (no dead holds; a hold is a 1–2 % drift).
- Speed comes from the transitions, not the shots: shots are slow, handovers are fast (0.6–1.2 s).
- The atmosphere moves continuously, gusting with the drama (light drift → driving snow).
- Type motion is small and quick (§4); nothing bounces.

## 6. Camera grammar

| Move | What it expresses | Can serve |
|---|---|---|
| Slow push into the subject band | attention; the weight of a moment | the key photo; a face; a ship |
| Lateral drift (parallax reveals the subject) | being there; looking around | a camp; a crowd; a landscape |
| Rise / tilt up within the photo | scale; awe | a mast; a cliff; a building |
| **Into the printed photo** | a record becomes the event (or the event becomes the record) | a newspaper; a book; a postcard; a photo on a wall |
| Whiteout / smoke-out | the elements take over; time passes | a storm; a fire; a launch; a battle |
| Route on the map | distance and danger | a voyage; a march; a flight |
| Pull back out of a photo into the page it is printed on | the story becomes history | the ending; the headline; the record |
| **The flash** | the moment the picture was made | a flash-powder photograph; a night scene |
| **Ice-crack shatter** | the world breaking | a ship crushed; a dam; a collapse |
| Across the desk | reading the record | a map, then the newspaper that reported it |
| Long-lens reconstruction | witnessing from a distance | a sinking; a fire; a launch seen from the shore |

Framing: the subject band in focus, at least a third of the frame height at its moment; type in the calm part of the frame. Transitions: only the moves above, plus a fade to black at the very end; never the same handover twice in a row (vary the weather: snow, blizzard, spray, the paper's white).

## 7. Sound palette

- **Score**: cinematic but restrained: low strings (sustains, tremolo for tension), felt or grand piano, a low drone, timpani or bass-drum swells only at the two or three peaks; build by register and density; one real silence (≥ 0.8 s) before the turn or the last card.
- **The place**: each photo has its air (wind, ice cracking and groaning, sea, crowd, machines, fire), panned and filtered by depth.
- **Transitions**: a rising swell or wind gust into every handover; a paper rustle for newspapers; a pen-scratch for the route line; a soft tick for each typed character group, a low hit when a number lands.
- **Mix**: the place −24…−18 dB, music under it at the quiet moments and over it at the peaks; voice (if any) forward with music ducked 6 dB; −14 LUFS.

## 8. Native moves

- **Into the printed photo** *(signature)*. A newspaper (or book, postcard) carrying a photograph fills the frame; the camera pushes into the printed photo; its halftone softens as it grows, the print's edge passes the frame, and the photo is now a 3D scene. Or in reverse, out of a scene onto the page. *Fits content like:* a headline that broke the story; a photo in a family album; a scientific paper's figure.
- **Whiteout**. The weather of the photo (snow, smoke, spray, dust) thickens until it fills the frame and clears on the next place. *Fits content like:* a blizzard; a launch; an explosion; a dust storm.
- **The route draws itself**. A red line with a moving head across a code-drawn map, its distance counting up beside it. *Fits content like:* a voyage; a migration; an evacuation; a supply line.
- **The number lands**. A figure counts up over the photo it belongs to and settles; a serif line says what it means. *Fits content like:* a death toll; a distance; a sum of money; a duration.
- **One word in red**. A story line rises in white and one word turns red and is underlined: the meaning of the scene. *Fits content like:* any turn in a story.
- **The flash**. Darkness, then the burst that made the photograph: the archive burns into view and settles as the exposure. *Fits content like:* a flash-powder night photograph; a magnesium portrait; a lightning-lit scene.
- **The shatter**. The photograph cracks from an impact point like plate ice or glass, then breaks into shards that tip and fall toward the lens, revealing the next. *Fits content like:* a ship crushed; an explosion; the moment a world breaks.
- **The record on the desk**. The real map and the paper that reported it, side by side under a lamp; the route draws itself in red ink over the printed line, the camera slides to the headline. *Fits content like:* a voyage and its news; a treaty and its signatures.
- **The reconstruction**. What no camera saw, rebuilt in 3D and tagged: seen from a distance, backlit, the way the witnesses saw it. *Fits content like:* a sinking; a crash at sea; a night crossing.

## 9. Pitfalls of the medium

- **Tearing**: one depth surface for a photo with people or ships stretches them across the background → cut bands at depth valleys, fill behind, keep moves in §2's limits.
- **Fill showing**: smooth membrane fill reads as a smear on a bigger move → add the photo's grain to the fill (done in `layers.py`), reduce the move, or put a nearer band edge across it.
- **Depth estimates are wrong on sky, snow, fog and reflections** → `--sky` flattens low disparity; check `<id>_depth_preview.jpg` before building a scene; split a band by hand when a subject straddles two.
- **Halftone and newspaper scans moiré** when pushed into → soften the page as it grows (a blur proportional to scale) until the printed photo is replaced by the full-resolution archive photo of the same image. The colour screen of a Paget plate or an autochrome is resolved in a good scan and aliases the same way when shown smaller → mipmapped textures, or `--blur` about 1 px.
- **The first scan you find is rarely the best**: national-library copy negatives are often only 1536 px; the holder's own glass plates, lantern slides and colour plates (state libraries, often mirrored on Wikimedia Commons or Flickr Commons) can be twice as large and continuous-tone → search the holder before cutting layers; a book half-tone is the last resort. A different print of the same negative may be framed differently: re-check the type's place.
- **Type over busy grain** is hard to read → a soft dark shadow behind white type, or move the line to calm sky / shadow.
- **Generated or colourised "archive"** turns up in searches → only take files with a holder, a record and a public-domain basis; reject "restored", colourised, upscaled or AI-labelled files.
- **Facts drift** in retellings (dates, distances, counts) → every figure from `FACTS.md`; flag where sources disagree and use the conservative one.
- **Particles too dense** read as a screen filter → 3–4 depths, varied size, most soft; dense only in a whiteout.
- **Grade state must not carry over** between frames (from Paper-cut Lightbox's post pipeline).
- **Print borders and scanner edges** read as near objects to the depth model and frame the picture on the first move → `--crop` every print before cutting layers.
- **Automatic cuts follow the histogram, not the story** (a ship can land in the sky band) → check the depth preview; cut by hand.
- **Inpainting can invent** people-like shapes and drift the colour of a fill → only parallax edges ever show it; keep moves inside the limits and check the end of every move.
- **Mist as a slab**: fog that ignores height paints a flat band across the sky → keep it below a height and thin.
- **Water that drags its neighbours**: a feathered water mask reaches into the people and boats beside it, and their outlines shimmer as the water flows → pull the mask back from them by about its feather (`flowmask.py --inset`), and flow only the bands that hold the water.
- **Reconstruction figures look like toys** when lit from the front → backlight them (near-black albedo, a warm rim) and let the depth of field soften them.
- **Showing how a picture was made** is a claim → check it (Hurley's night photograph: 25 charges fired at once, not a sequence of flashes).
- **Short beats break the reading rule** → lay out every line against `chars ÷ 15 + 1.5 s` before timing the shots; a beat is as long as its words need.
- **CPU rendering**: a transition that draws two scenes (a portal, a shatter) doubles the frame time and can pass the render tool's 30 s per-frame limit, which stops the whole render → render the outgoing picture once, frozen at the moment of impact, and keep it; keep DoF off flat shots; render long films with a resumable frame renderer (`demo/tools/frames.mjs`).

## 10. Engine

`demo/tools/layers.py` (depth → bands, LaMa inpainting in tiles (or membrane fill), alpha, extended depth surfaces, full disparity and preview; `--crop`, `--blur`, `--bands`, `--res`), `demo/tools/flowmask.py` (water masks), `demo/tools/frames.mjs` (resumable frame rendering), and the page in [`demo/`](demo/): `engine/photo3d.js` (photo meshes unprojected from depth, with flowing water, depth mist and a light level for flashes), `engine/atmos.js` (snow, dust, spray with per-particle depth of field), `engine/shatter.js` (the ice-crack shatter: Voronoi shards textured with the outgoing frame), `engine/type.js` (the four type roles; every line registers its box for the reading check), `engine/post.js` (DoF, halation, grade with split tone and lens fringing, whiteouts in any colour), `scenes/desk/desk.js` (the desk, its lamp, the papers and the red ink), `scenes/sinking/` and `scenes/wave/` (the two reconstructions), `main.js` (shift lens, transitions that draw two shots), `story.js` (the timeline). **Into the printed photo** (the first version of the demo) is a portal: the 3D scene rendered with its camera matched to the print's place on screen, mixed over the halftone, taking over with the same camera when the print covers the frame; its code is in this folder's git history (commit `3bd06ca`, `demo/main.js` and `demo/story.js`). Techniques from `$LIB/styles/archive-lighttable/demo/tools/prep.py` (push-pull fill) and Parallax Journey (portal, DoF pipeline from `$LIB/styles/paper-lantern/demo/src/post.js`). File map in [DEMO.md](DEMO.md).

## 11. Variation space

You decide the event, the photographs, the order, the numbers, the transitions, the opening and the ending. Use cases are grammar for the order and duration of information:

| Use case | Information order | Hold | Length |
|---|---|---|---|
| **One event, told fast** | title + date → the setting → the turn (one red word) → the number → the outcome | story line ≥ chars/15 + 1.5 s; number ≥ 3 s | 25–40 s |
| **History explainer (narrated)** | hook photo → context (map) → 3–5 beats, one photo each → the consequence → today | 6–12 s per photo | 2–10 min |
| **A person's life** | portrait → origins → the moment → the cost → the legacy | 5–8 s per photo | 60–120 s |

Openings: **black and a sound** (wind, a crowd) before the first photo fades up; **the newspaper first**, then into its photo; **a date typed on black**. Endings: **out of the last photo onto the page that printed it**; **the number that sums it up**, held, then black; **today**: the place now (only if a public-domain or own photo exists).

---

How our demo was made (story, sources, build): [DEMO.md](DEMO.md). Read it after your treatment exists.
