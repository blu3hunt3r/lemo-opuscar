# Documentary Parallax — Style Prompt

Made from a blank page; techniques from Archive Light Table (archive-lighttable) and Parallax Journey (the user's own style) in Lemo-Opuscar.

> Real public-domain archive photographs turned into slow, cinematic 3D scenes. Every photo is cut into depth layers with what hides behind its subjects filled in; the camera pushes and drifts inside it while weather and dust move through the air. Scenes hand over through objects (a photo printed in a newspaper, a whiteout, a map line), and a bold editorial type system carries the facts with one word in red.
> References (grammar only): the "3D parallax" history-documentary look of contemporary YouTube channels, and the 2.5D photo animation of archival documentaries. Do not copy any channel's intro, branding, title cards, music or frames.

## 1. Essence, and what it is not

- **The pictures are real.** Every image is a public-domain (or CC0) archive photograph, a newspaper page or a map from an open collection, at its own tones, grain and damage. Nothing is generated, colourised, upscaled, retouched or re-staged. A fact on screen comes from a source in `FACTS.md`.
- **Each photograph is a place the camera enters.** A photo is split into 2–3 depth bands; each band is a surface in 3D shaped by estimated depth, with the area a nearer band hides filled in. The camera pushes, drifts and rises a little, so the photo opens up without tearing.
- **The air moves.** Snow, spray, smoke or dust drift at several depths in front of and behind the subjects, so a still photograph has weather.
- **One continuous telling.** Scenes hand over through objects and the medium itself (into a printed photo, a whiteout, a map), never by plain cuts or crossfades.
- **Editorial type.** Big titles, one serif line with one red word, numbers that land. Few words, held long enough to read.

Not AI imagery or "restored" archive (no generated, colourised or upscaled pictures; never stand a generated image in for an archive one), not a Ken Burns pan (a flat photo slid and zoomed has no depth), not Archive Light Table (no table, loupe, catalogue cards or measuring marks on objects), not a slideshow (no hard cuts or dissolves between photos, except the fade to black at the very end), not a trailer (no whooshing whip pans, no impacts on every cut).

## 2. Materials & rendering

- **Sources**: open collections with masters and records (Library of Congress incl. Chronicling America newspapers, NARA, Smithsonian Open Access, Wikimedia Commons files with a clear public-domain basis, national libraries' out-of-copyright collections). Public domain needs a reason that applies (e.g. taken before 1955 in Australia, published before 1931 in the US); "no known restrictions", CC BY-SA and rights-managed scans are not enough: name the terms and ask. Keep `SOURCES.md` (file, creator, date, holder, URL, licence and its evidence, size) and `FACTS.md` (claim, value, source URL, quoted wording).
- **Depth**: a monocular depth estimate (Depth Anything V2 Small, Apache-2.0, run offline on CPU by `tools/layers.py`), normalised to 0–1 disparity. **Cut it into 2–3 bands at valleys of its histogram** (or by hand where a subject straddles a valley). Band k keeps everything at least that near; its colour fills the area the next band covers (membrane fill + the photo's own grain); its alpha is feathered 2–4 px; its depth surface is extended smoothly past its edge so border vertices never stretch.
- **Geometry**: each band is a grid mesh (≈ 200 × 120 vertices) unprojected from the scene's start camera: vertex = ray(uv) × Z, with 1/Z interpolated in disparity between the photo's far and near distances (sky flat at the far distance). From the start camera the composite is the original photo exactly.
- **Moves stay inside the fill's tolerance**: lateral travel ≤ 3 % of the near distance per second of screen time, dolly ≤ 20 % of the near distance over a shot, rotation ≤ 2°. Bigger moves show the fill. A tall print is framed with a **shift lens** (the projection centre moves, the camera does not turn), so a rise can travel the whole print while the camera itself stays within these limits.
- **Atmosphere**: billboard particles in 3D (snow, ice crystals, spray, smoke, dust) at 3–4 depths, soft, drifting with wind and gusts; particles in front of the focus plane go large and soft in the depth of field.
- **Lens and grade**: physical depth of field (focus on the subject band; the nearest band soft when the subject is mid-ground); halation on highlights (bloom, low strength); vignette; a cool shadow lift and warm highlights only as a grade, never a colour cast on the photo; fine moving grain at mux (grain 3–4). Gate weave ≤ 0.5 px and exposure flicker ≤ 2 % at most.
- **Maps** are drawn by code from public-domain data (Natural Earth): land in the paper tone of the film, sea darker, the route in the signal red drawn on as a line with a moving head.

## 3. Colour logic

- **The archive's own tones** carry the picture (silver greys of glass plates, paper tans of prints, newsprint). Grade them as a whole (shadow lift, highlight warmth, contrast), never tint parts of them.
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

Framing: the subject band in focus, at least a third of the frame height at its moment; type in the calm part of the frame. Transitions: only the moves above, plus a fade to black at the very end.

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

## 9. Pitfalls of the medium

- **Tearing**: one depth surface for a photo with people or ships stretches them across the background → cut bands at depth valleys, fill behind, keep moves in §2's limits.
- **Fill showing**: smooth membrane fill reads as a smear on a bigger move → add the photo's grain to the fill (done in `layers.py`), reduce the move, or put a nearer band edge across it.
- **Depth estimates are wrong on sky, snow, fog and reflections** → `--sky` flattens low disparity; check `<id>_depth_preview.jpg` before building a scene; split a band by hand when a subject straddles two.
- **Halftone and newspaper scans moiré** when pushed into → soften the page as it grows (a blur proportional to scale) until the printed photo is replaced by the full-resolution archive photo of the same image.
- **Type over busy grain** is hard to read → a soft dark shadow behind white type, or move the line to calm sky / shadow.
- **Generated or colourised "archive"** turns up in searches → only take files with a holder, a record and a public-domain basis; reject "restored", colourised, upscaled or AI-labelled files.
- **Facts drift** in retellings (dates, distances, counts) → every figure from `FACTS.md`; flag where sources disagree and use the conservative one.
- **Particles too dense** read as a screen filter → 3–4 depths, varied size, most soft; dense only in a whiteout.
- **Grade state must not carry over** between frames (from Paper-cut Lightbox's post pipeline).

## 10. Engine

`demo/tools/layers.py` (depth → bands, membrane fill with grain, alpha, extended depth surfaces, preview; `--crop` trims a print's border, `--blur` removes halftone moiré), and the page in [`demo/`](demo/): `engine/photo3d.js` (photo meshes unprojected from depth), `engine/atmos.js` (snow, dust, spray with per-particle depth of field), `engine/type.js` (the four type roles; every line registers its box for the reading check), `engine/map.js` (Natural Earth map and the route), `engine/post.js` (DoF, halation, grade, whiteout), `main.js` (shift lens, portals). **Into the printed photo** is a portal: the 3D scene is rendered with its camera matched to where the print sits on screen (its fov from the print's size, its projection centre from the print's position), then mixed over the halftone of the page; when the print covers the frame, the scene takes over with the same camera, so the cut cannot be seen. Techniques from `$LIB/styles/archive-lighttable/demo/tools/prep.py` (push-pull fill) and Parallax Journey (portal, DoF pipeline from `$LIB/styles/paper-lantern/demo/src/post.js`). File map in [DEMO.md](DEMO.md).

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
