# Liminal Found Footage · Baked Light — Style Prompt

Based on Liminal Found Footage (backrooms) from Lemo-Opuscar.

> Camcorder tapes recovered from empty, endless, fluorescent-lit spaces. Rules instead of monsters. The light is real: it stops at walls, pools on the floor, bounces the walls' colour onto the ceiling, and answers to something.
> Genre reference (grammar only): "the Backrooms" internet folklore and new-weird / rule-horror; 1990s consumer camcorder footage. **Never** use the word "Backrooms", wiki "Level" numbers, community entity names, or any existing organisation, school, company or logo inside the film. Everything on screen (rules, forms, institutional voice, any presence) is original.

Suits short films; the length follows the walk, and the dread thins out once nothing new goes wrong.

## 1. Essence, and what it is not

- **One first-person camcorder recording** (1990s VHS, 4:3), handheld, continuous.
- **An empty, familiar-but-wrong interior** that repeats: an office, a hotel floor, a school, a mall, a parking level, a hospital wing. Humming fluorescent light, no people.
- **Dread from emptiness, repetition, bureaucratic rules, and the camera's own machinery failing at the wrong moment.** Nothing chases anyone. A chill on the back of the neck, not a jump.
- **The medium is the storyteller**: focus, exposure, tape damage, the on-screen display, and **the light itself** (which fixtures are on, which room is lit) carry the plot.

Not a horror film (no monster close-ups, no gore, no jump scares, no score stings), not an ASCII/CRT terminal piece (the artefacts are tape and lens, not phosphor and scanlines), not a ruin (clean is part of the style), not a showcase of render tech (the light must read as a cheap building's ceiling grid, never as a game engine).

## 2. Materials & rendering

- **Frame**: 4:3 pillarboxed in 1920×1080. Render 3D at low resolution (e.g. 720×540) and let the VHS pass upscale; low resolution hides CG cleanliness.
- **Space**: axis-aligned, full-height partitions on a grid with gaps and stubs, pillars, a drop ceiling of tiles with recessed light panels at regular intervals. A hand-authored route through procedurally filled space, so every doorway shows more emptiness. Walls run floor to ceiling: this is what lets plan-view visibility (below) be exact.
- **Lighting = thousands of lights, baked, occluded.** Every panel is a rectangular downward area emitter (0.6×1.2 m, cosine lobe). Light reaches a surface only if the straight line from the panel to it crosses no wall in plan view; the panel's area gives soft edges, so inside one room the light stays soft and almost shadowless, while walls cut it hard: a lit room next to a dark one, a pool of light spilling through a doorway onto the corridor floor, a dark room that stays dark. Plus **one diffuse bounce**: light that hits the floor and walls lights the ceiling and the far side of the room, carrying their colour. Ceilings are lit only by bounce, so they read dimmer than the floor and tinted.
- **The bake** (three.js r187): static meshes get light-map UVs from `unwrapUVs` (floor and ceiling use their plan coordinates directly); `LightMapper` accumulates irradiance per texel (16–256 jittered samples, half float), from a TSL irradiance function: direct light from each panel with a 2D visibility lookup + bounce from virtual point lights placed where the panels' light lands. Maps are baked once per space and saved; the film never re-bakes.
- **Light-style layers**: every light that changes during the film (a bank switching, a tube that dies, a room that lights up) is baked into its own layer, three layers per bake pass (one luminance channel each); lights that never change share one steady layer; a per-texel chroma map, from one bake with everything on, colours them. At render time each layer is scaled by its own curve over time, so switching, flickering and dying are exact and free. Only lights planned before the bake can change; a global blackout scales every layer.
- **Fog follows local light**: fog colour × (baked floor irradiance under the fragment / average). Where lights are off the haze is dark, so a silhouette there reads as a *hole in the light*. Background = fog × ~0.15, so corridors dissolve into darkness, never a bright wall.
- **Moving things are not in the bake**: shoes, doors that swing, a cart, a silhouette are lit at render time from the floor light map under them (a free light probe), never baked.
- **Gloss**: hard floors (linoleum, tile, polished concrete) get a runtime specular streak from the lit panels nearest the reflection point, weighted by that panel's layer at the fragment, so a dark panel never reflects. Carpet stays matte.
- **Restrained decay**: tide-marks at the foot of some walls, a discoloured band under the ceiling, rare peeling seams, a few yellowed or missing tiles, dead insects in diffusers. Percentages in single digits.
- **Printed matter**: office laser-print on yellowed paper, condensed sans headers, form numbers and revisions, numbered rules, a polite closing line from "Management" or the institution. Pinned or taped.
- **VHS camcorder pass** (not a CRT): small line jitter (≤ 0.25 px low-frequency wobble), a head-switching band, tracking tears on demand, barrel + vignette on the image but **not** the OSD, luma blur + edge ringing, chroma smeared right, light smear, drifting white balance, AGC noise in darks, dropouts, lifted blacks, soft clip. Noise at tape rate (30 fps). No scanlines, no RGB mask.
- **OSD**: a hand-made bitmap font with a black outline: REC dot, battery, time and date. A camcorder title generator uses the same font, larger.

## 3. Colour logic

- **One dominant sickly hue** from the location's materials (mustard wallpaper, institutional green, hospital blue, beige laminate), with a darker trim and a mottled floor of the same family; light panels near-white and slightly warm. **The bounce spreads the hue**: ceilings near walls and the dark sides of rooms take the wall colour, so the whole volume of air feels tinted, not just the walls.
- **Exactly one saturated colour**: a signal such as a red alarm lamp, a green emergency sign, an amber warning light, a sensor's red LED. It is the only thing that blooms (drive its emissive high enough to cross the bloom threshold). It is not baked as a light unless it is large enough to colour a wall; a dot stays a dot.
- White balance drifts; colour is never graded clean.
- Example material palettes: wallpaper `#d5bd66`, trim `#4d3d26`, carpet `#8c763c`; pool tile `#9fc7c0`, grout `#e6ece6`, water `#5e8f96`; school corridor `#b9c49a`, lockers `#6f7f66`, linoleum `#a89a7d`.

## 4. Type & subtitles

- **Closed captions (CEA-608 style)**: a monospace (e.g. IBM Plex Mono 600) ~42 px, white on a solid black box per row, ≤ 32 characters, centred inside the 4:3 frame above the OSD. Untouched by tape noise (the TV decodes them). Hold ≥ max(1.8 s, speech + 0.6 s).
- **Speaker marks**: `[PA]` for announcements, italics for the operator, SDH descriptions in brackets (`[LIGHTS FLICKER]`, `[TAPE NOISE]`, `[SILENCE]`, `[RELAYS CLICK OFF]`).
- **Rules on notices are not captioned**: they are the picture. Readable at 1080p, ≥ 3–4 s uncovered, and as long as (characters ÷ 15 + 1.5) s. For close-ups **lower the camera so the lens is parallel to the page**; pitching down at a vertical sheet shears words into fake italics. Light the notice from the panel in front of it, never from a panel behind the wall it hangs on.
- The **title** is camcorder title-generator text over the first shot.

## 5. Motion quality

- **One continuous handheld take.** Cuts happen only where the tape breaks: power-on roll-in, tracking tear, REC off.
- **Handheld** = walking gait (head bob a few cm, sway, small roll) + breathing (~0.27 Hz) + tremor noise at a few frequencies whose amplitude follows a **fear** curve. At a held breath, **freeze all of it**.
- **Looking down** shows only shoe toes and floor, never legs.
- **Autofocus** = focus distance animated with overshoot: blur → lock → slip → lock. Blur comes from pulling focus *near*. Zoom narrows the FOV and opens the aperture.
- **Lights change by layer.** A fluorescent strike: two or three dim ticks, a buzzing flicker, full on in 0.4–0.8 s; a switch-off: a relay click and a 50 ms fade. Short blackouts (~0.1 s) scale every layer; auto-exposure catches up with a lag (~0.45 s) and gain noise pumps. When a whole room goes dark the camera's AGC lifts the noise, it never lifts the black.
- Things move by themselves slowly (a door over >1 s, eased), never snap. Light can snap: it is a switch.

## 6. Camera grammar

A vocabulary, not a route. Opening and ending come from the topic.

| Move | What it expresses | Can serve |
|---|---|---|
| Walking POV down a corridor | routine, the endless | establishing the space; time passing |
| Slow pan off a detail to the space | scale; the space goes on | a reveal; a first look |
| Glance down at the feet | obedience, avoidance | obeying a rule; not looking |
| Crouch and hold on printed text | reading; bureaucracy | a rule; a contradiction |
| Zoom + focus hunt into the distance | seeing / not seeing | a presence; a doubt |
| Identical framing after a tear, only the OSD changed | time removed | a jump; a loss |
| Turn a corner, hold still | a threshold | an exit; a choice |
| Slow push-in with no sound | the pull of something | a door; a sign |
| Backing away while filming | retreat, fear | leaving a room; a rule broken |
| Camera set down on a surface, static, recording alone | abandonment | the operator gone; a long wait |
| Whip toward a sound, then nothing | expectation denied | a noise with no source |
| Hold still while the light changes around the frame | the building answering | a presence shown only by light; a timer |

Framing: text readable and uncovered; any presence small, far, and in a region of dark panels, or not drawn at all. Transitions: tape events only.

## 7. Sound palette

- **No score.** Only what the tape would have recorded. Music exists only inside the world (hold music, a radio through walls, a tinny PA jingle), filtered and reverberant, possibly slowing with tape wow.
- **Fluorescent bed**: 120 Hz (or 100 Hz) + harmonics, a buzzy band-passed component, a faint ballast whine, bad-tube bursts; **gated by the same layer curves as the picture**, each lit fixture adding its share by distance; closer in small rooms.
- **Switching**: every layer change in picture has its sound on the same frame: relay clunk, ballast tinks, strike buzz on; relay click off. Distant ones quieter and wetter (long corridor reverb).
- **PA voice**: calm, corporate, through a ceiling speaker (band-pass ~300–3500 Hz, cone resonance, saturation, room reverb), dry enough to stay intelligible. A short original chime before announcements; after a time jump, chime and voice may drift flat.
- **Operator**: a few short, quiet lines with proximity bass and breath; breathing whose rate follows fear; a held breath and one long exhale.
- **Foley by material**: carpet steps (low thud + wet squelch) or hard-floor heel taps and squeaks, cloth rustles, camcorder clack and motor, zoom servo, AF ticks, ballast tink on flickers, a stick-slip hinge, a drag overhead, a vending machine, a pipe.
- **Silence**: digital zero for a second or more (tails included), captioned `[SILENCE]`, is the strongest tool. A soft scare at most: everything restriking at once when sound returns.
- **Drone** options: a low brown-noise band with beating sines rising slowly; the room tone itself pitch-shifting; nothing.
- **Mix**: bed and in-world music ≈ −8 dB under voices. −14 LUFS; no added grain (the noise is in the picture).

## 8. Native moves

A menu: use the ones your story needs.

- **Autofocus / auto-exposure hunting.** Something is there only while focus is correct. *Fits content like:* a missing pet on a hotel floor; a figure in an empty stadium; a shape at the end of a hospital corridor.
- **Tape tracking damage.** A tear is a cut the universe made; same framing after, but the clock jumped, the battery drained, a light died. *Fits content like:* a night-watch log; a lost weekend in a mall; a house that ages between tapes.
- **The OSD is plot.** REC, battery, date and time code are evidence. *Fits content like:* an alibi; a countdown; a dated inspection.
- **Rules as text in frame.** Notices and PA announcements start ordinary, drift wrong, contradict each other, and finally address the viewer. *Fits content like:* a pool's safety rules; a school fire drill; a museum after hours.
- **Emptiness and repetition.** The same notice in a different place; the same room with one detail changed; a corridor into fog. *Fits content like:* a moving-day walkthrough; an airport at 4 a.m.; an office after layoffs.
- **The light answers.** Panels and rooms switch on and off in a pattern the operator didn't cause: a room lighting up behind a closed wall, a chain of fixtures coming down a corridor, the dark following something away. The presence is the light; nothing is drawn. *Fits content like:* motion-sensor lighting after hours; a building's timer program; a power cut moving floor by floor.
- **The thing that is almost human.** A distant silhouette wrong by 15–40 % (small head, long neck, narrow high shoulders, long arms), drawn as organic curves on a billboard, moving slowly, lit only from the floor map under it. *Fits content like:* a mannequin that is not; a night guard; a reflection that lags.

## 9. Pitfalls of the medium

- **A fully bright scene reads as a hospital corridor** → partitions with gaps; far areas fall dark; most of the frame is lit by one or two panels.
- **Background shows as a bright rectangle** at a corridor's end → background = fog × ~0.15.
- **Uniform fog lifts silhouettes to grey** → fog follows local light (the baked floor map).
- **Line wobble skews text; pitching down italicises it** → ≤ 0.25 px wobble; lower the camera.
- **Primitive-built figures read as toys**, primitive legs as tubes → organic silhouettes; show only shoe toes.
- **Pure red never blooms** at low emissive (low luminance) → drive it far higher.
- **Normalising a filtered signal by its pre-filter peak** blows up a bus → normalise the processed signal.
- **Heavy PA reverb destroys intelligibility** → ASR-check processed lines and the full mix.
- **Time-compressing a finished timeline** → keyframes in original time mapped through one warp function, including hard-coded times elsewhere.
- **Baked light can't follow anything that moves** → keep the space static; doors, carts and figures are lit from the floor map at render time; a door that opens is a planned layer change for the room behind it.
- **A light that wasn't planned can't switch** → list every changing light before the bake; adding one means re-baking its pass.
- **Atlas seams and texel bleed**: dark lines along edges, light leaking under walls → ≥ 4 px padding in `unwrapUVs`, walls start a few mm below the floor and above the ceiling, sample positions offset 1–2 cm along the normal.
- **Plan visibility starting inside a wall** self-shadows the wall → start each visibility test from the surface point pushed out along its normal.
- **Bounce from point lights blotches** (bright spots near each virtual light) → clamp distance (d² + 0.3), use ≥ 48 virtual lights per panel, average over many bake samples.
- **Half-float accumulation saturates** past ~256 samples in `LightMapper` → stop at 128–256; denoise nothing.
- **The WebGPU canvas captures black** in headless Chrome → bake with `WebGPURenderer({ forceWebGL: true })` and read maps back with `readRenderTargetPixelsAsync`; render the film with `WebGLRenderer`.
- **Light maps read back from the WebGL2 backend are flipped in v** → sample at `(u, 1 − v)` and check one known pool of light against its panel before going on.
- **The camcorder AE has no idea what it is looking at** → drive it from the light near the camera, and trim it by hand on bright close-ups (notices, the floor at the feet), or paper blooms over its own text.
- **Layer maps are large** (a 2048² half-float RGBA map is 32 MB) → floor and ceiling maps cover only the lit area; walls share one atlas; load maps once per worker.

## 10. Engine

Two stages on three.js r187 (the project pins `three@0.187.0`; don't use the library's shared copy). **Bake**: [`demo/bake/bake.js`](demo/bake/bake.js) (WebGPURenderer with `forceWebGL`, `unwrapUVs` for wall atlases, one `LightMapper` per surface set and pass, readback) run by [`demo/tools/bake.mjs`](demo/tools/bake.mjs) into `bake/*.bin`; [`demo/light2d.js`](demo/light2d.js) (plan-view polar shadow maps for every panel sub-point and virtual light, virtual-light placement). **Film**: [`demo/world.js`](demo/world.js) (layout, fixtures, sensors, layers, shared by both stages), [`demo/look.js`](demo/look.js) (materials reading the layer maps, fog, gloss), [`demo/tex.js`](demo/tex.js) (procedural surfaces and notices), [`demo/vhs.js`](demo/vhs.js) (VHS camcorder ShaderPass), [`demo/osd.js`](demo/osd.js), [`demo/subs.js`](demo/subs.js), [`demo/story.js`](demo/story.js) (timeline, layer curves, camera keyframes, focus / fear curves), [`demo/main.js`](demo/main.js) (renderer, post chain DOF + bloom → VHS, handheld rig, events). Base techniques: `$LIB/styles/backrooms/DEMO.md`. File map and build: [DEMO.md](DEMO.md#build-notes).

## 11. Variation space

You decide the location and its materials, the procedure or reason for filming, the rules, the route, which lights change and when, the presence (or none), the signal colour, the opening, the ending and the length.

All far from our demos:

- Structures: **two tapes** (the same route filmed twice, a year apart; the second tape finds what changed); **a real-estate walkthrough** where every room is described cheerfully by the operator while the house keeps adding rooms; **a checklist read aloud** item by item, each item ticked on a clipboard in frame, until an item is not on the list; **a power cut moving floor by floor** toward the camera's floor.
- Openings: **mid-sentence** (the tape starts with the operator already talking, tracking still rolling in); **a test pattern** and a date slate before the camera is picked up; **the lens cap on**, sound only, until the cap comes off.
- Endings: **battery dies** (the icon blinks, the frame freezes on the dead cell); **the camera is set down** and keeps recording an empty room; **the tape loops** back to the first shot, now with the operator's shoes visible in it; **every light comes on at once** and the space is empty to the horizon.

---

How our demo was made (story, shots, score, build): [DEMO.md](DEMO.md). Read it after your treatment exists.
