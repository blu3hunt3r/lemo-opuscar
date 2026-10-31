# Documentary Parallax — our demo

One example among many. Don't reuse its story, arc, shots, photographs or timings.

Demo: *Endurance* (32 s) · `test.mp4` · source in [`demo/`](demo/)

## Story & structure

Shackleton's *Endurance* (1914–16), told in 32 s with no voice. A cold open on the record: the New-York Tribune's front page of 4 September 1916, "Shackleton Rescues His Marooned Men", a red hand-drawn line under *Marooned*. The camera pushes into the printed portrait; before it fills the frame the halftone softens and the portrait starts to breathe in 3D (the signature, **Into the printed photo**). Snow blows across his face and whites out the frame: back a year, the ship frozen into the Weddell Sea at night (title **ENDURANCE**). Whiteout: the wreck, "The ice *crushed* her." Whiteout clears onto a map: the drift, then the James Caird's 1,300 km drawn in red while the distance counts up. The score stops; the camera dives into Elephant Island; sea spray whites out; the men on the beach, and **28** lands: "men. Every one *lived*." Fade to black.

Arc: the record (a question: marooned?) → the setting → the turn (one red word) → the number (distance) → the outcome (the number that sums it up). This is §11's "One event, told fast".

## Shots

| t (s) | Scene | Camera |
|---|---|---|
| 0.45–4.5 | Front page (Chronicling America scan) | drifts from the date line to the headline, then a push that accelerates into the printed portrait; the portrait is a portal onto the 3D scene, mixed over the halftone from 2.85 s |
| 4.5–8.75 | The portrait (the paper's own print, 2 bands: wall, figure) | the same camera continues inside: fov from the print's size on screen, projection centre from its position, plus a 0.3 m dolly and 3.5 cm drift for parallax |
| 8.75–14.0 | p1, Hurley's night flash (3 bands: sky, ship, ice) | push through the ice toward the ship (1.55 m of an 8 m near distance), shift lens up 0.2 to keep the mast heads |
| 14.0–19.4 | p3, "The End" (3 bands: sky, wreck and snow, dogs) | rise from the dogs to the broken masts: shift lens travels 0.58 of the print while the camera rises 0.35 m and pushes 0.55 m |
| 19.4–25.6 | Map (Natural Earth, orthographic at 45° W 65° S) | over the Weddell Sea with the drift line, north with the James Caird line, then a dive into Elephant Island |
| 25.6–32 | p6, the men on the beach (3 bands: sky and mountains, sea, men) | lateral drift 0.42 m with a 0.9 m push; fade to black 30.9–31.7 |

## Palette & type

- The archive's own tones: the page's newsprint grey, the sepia of the 1916 Underwood prints, the silver grey of the copy negative. Graded as a whole (contrast .14, a slight cool lift, warm gain, vignette .38); grain 3 at mux.
- One red, `#d7322b`: the underline under *Marooned*, the red words *crushed* and *lived*, the route line and its head, the caret of the title.
- White type with a dark shadow on the dark pictures (the night sky, the coat, the sea); ink type with a paper halo on the light ones (the wreck's sky, the beach's sky).
- Map: land `#d8cfbd` with paper grain, sea `#1c2228`, coast `#8d8576`, graticule at 16 %, labels in Plex Mono.

## Depth layers (tools/layers.py)

| Photo | Cuts (disparity) | Notes |
|---|---|---|
| p1 | automatic valleys 0.164, 0.664 | the print's light edge went into the middle band until it was cropped (`--crop`) |
| p3 | by hand 0.14, 0.63 | automatic valleys put the wreck in the sky band; the dogs need their own band or they stretch across the snow |
| p6 | automatic 0.18, 0.555 | clean: sky and mountains, sea, the men |
| portrait | by hand 0.30 (2 bands) | three bands put the cap's crown in front of the face; one figure band keeps its relief without tearing |

## Score structure

See `demo/mix.py` and its notes. Sparse piano and a drone on the page, strings entering on the portrait, ice and tremolo through the night ship and the wreck (one timpani swell into the wreck), a pulse under the route, **a real silence of the score (≥ 0.8 s) before the dive**, then the low hit as 28 lands and a full chord under the fade. Wind gusts rise into every whiteout; paper, pen scratches on the underline and the route, ticks on typed text.

## Build notes

```
demo/
  index.html, main.js   page contract, shift lens, portals, post → final
  story.js              timeline: scenes, camera paths, whiteouts, type, sound events
  engine/photo3d.js     a photo's depth bands as meshes unprojected from the start camera
  engine/atmos.js       snow / dust / spray in view space, per-particle depth of field
  engine/type.js        title, tag, story line (one red word), number; registers boxes for readcheck
  engine/map.js         Natural Earth land, graticule, labels; the route canvas redrawn per frame
  engine/post.js        MSAA → DoF gather → bloom → grade, whiteout (from Paper-cut Lightbox via Parallax Journey)
  tools/layers.py       depth (Depth Anything V2 Small, ONNX, CPU) → bands, fill, alpha, depth grids
  assets/raw/           the public-domain scans used (see SOURCES.md), land.geojson, route.json
  FACTS.md, SOURCES.md  every fact with its quote, every image with its public-domain basis
  mix.py                score and sound from events.json
  film.sh               builds in place; build.sh copies demo/ to $OUT and runs film.sh there
```

`sh demo/build.sh` with `LIB=` the library folder and `OUT=` a build folder (default `$LIB/films/endurance-build`). It downloads three.js and the fonts from npm and the depth model from Hugging Face, makes a Python venv (onnxruntime, numpy, pillow, scipy), cuts the layers, then events → mix → frames → mux → poster. `QUICK=1` stops after six stills. On a 4-core machine without a GPU (SwiftShader): the QUICK run (npm, model download, venv, layers, events, mix, six stills) takes 2 min; the frames take 41 min with 3 workers (~9 s per frame per worker at SSAA 1.25); mix 10 s. Rebuilding from the saved `demo/` reproduces the stills pixel for pixel and the mix bit for bit.

### Pitfalls we hit

- **Print borders**: every LoC scan carries a light card edge; the depth model reads it as a near object and the camera's first move shows it as a frame. Crop each print (`--crop`) before cutting layers.
- **Automatic cuts follow the histogram, not the story**: in the wreck the deepest valley lay between the snow and the dogs, leaving the ship in the sky. Check `<id>_depth_preview.jpg` and cut by hand.
- **The portal must match the print exactly**: the 3D scene renders with `cover: 1` (the photo's full extent equals the print rectangle) and no camera drift until the print covers the frame; otherwise the photo slides inside its own frame.
- **Halftone portrait**: a 1916 newspaper print at 2× magnification moirés; a 1.6 px blur before depth and texture keeps the dots as texture, not interference.
- **Light skies**: white type with a shadow is weak over the sepia sky of the wreck and the overcast beach; ink type with a paper halo reads better and keeps the editorial look.
- **Snow bokeh**: flakes nearer than ~1.3 m with the photo's aperture turned into big pale discs that read as a screen filter; the atmosphere has its own aperture (`atmos.aper`), separate from the photo's DoF.
- **Readcheck renders every step**: run it at a tiny resolution (`--q 'ssaa=0.25' --step 0.1`); `TEXTS` doesn't depend on the picture.
- **Screenshot timeout**: the render tool gives each frame 30 s. The opening frames draw two scenes (the page and the portrait inside it); with 4 workers sharing 4 CPU cores they passed 30 s. Turning off DoF on the flat shots (page, map: `maxCoc: 0` skips the 96-tap gather), SSAA 1.25 and 3 workers keep every frame well under.
- **A counter must move with what it counts**: the distance first counted with an ease-out while the line drew with an ease-in-out, so it read 682 km while the line had barely left the island. `number()` takes the same `ease` as the route.
