#!/bin/sh
# Rebuild "Wing C" from scratch: sh films/wing-c/build.sh   (LIB = the Lemo-Opuscar library folder; OUT = where renders go)
# Steps: three r187 → light bake (once) → events → sound mix → frames → mux (−14 LUFS) → subtitles → poster
# QUICK=1: a smoke test (small bake, events, mix, three stills; no video) that checks the whole chain runs in a few minutes
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=${LIB:-$(cd "$HERE/../.." && pwd)}
OUT=${OUT:-$HERE/out}
WORKERS=${WORKERS:-4}
export LIB
[ -f "$LIB/core/render/video.mjs" ] || { echo "set LIB to the library folder"; exit 1; }
PY="$LIB/.venv/bin/python"
mkdir -p "$OUT"
# 0. the project pins its own three.js (r187) and fonts (OFL, from npm)
[ -f "$HERE/node_modules/three/package.json" ] || (cd "$HERE" && npm i --silent three@0.187.0 @fontsource/ibm-plex-mono @fontsource/ibm-plex-sans-condensed @fontsource/ibm-plex-sans)
F="$HERE/node_modules/@fontsource"; mkdir -p "$HERE/fonts"
cp "$F/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2" "$HERE/fonts/IBMPlexMono-500.woff2"
cp "$F/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2" "$HERE/fonts/IBMPlexMono-600.woff2"
for w in 400 600 700; do cp "$F/ibm-plex-sans/files/ibm-plex-sans-latin-$w-normal.woff2" "$HERE/fonts/IBMPlexSans-$w.woff2"; done
for w in 600 700; do cp "$F/ibm-plex-sans-condensed/files/ibm-plex-sans-condensed-latin-$w-normal.woff2" "$HERE/fonts/IBMPlexSansCondensed-$w.woff2"; done
cd "$LIB"
# 1. light bake: r187 WebGPURenderer (WebGL2 backend) + unwrapUVs + LightMapper → lm/ (≈ 15 min on CPU rendering; skipped when present)
if [ -n "$QUICK" ]; then [ -f "$HERE/lm/manifest.json" ] || node "$HERE/tools/bake.mjs" --spp 8 --wall 256 --plan 256
else [ -f "$HERE/lm/manifest.json" ] && [ -z "$REBAKE" ] || node "$HERE/tools/bake.mjs" --spp 8 --wall 1536 --plan 1024; fi
# 2. the page's timeline → events.json (sound cues, captions, the 50 Hz light track)
node core/render/events.mjs "$HERE"
# 3. sound: hum driven by the light layers, relays, steps, breath, camcorder → mix.wav
"$PY" "$HERE/mix.py"
if [ -n "$QUICK" ]; then node core/render/still.mjs "$HERE" 4.0 35.0 44.2 --out "$OUT/quick" && echo "quick check done: $OUT/quick" && exit 0; fi
# 4. frames → video
node core/render/video.mjs "$HERE" --fps 24 --workers "$WORKERS" --out "$OUT/video.mp4"
# 5. mux (two-pass loudnorm −14 LUFS; grain 0: the tape noise is in the picture), then re-encode for grain (smaller file, same look)
sh core/render/mux.sh "$OUT/video.mp4" "$OUT/mix.wav" "$OUT/wing-c_crf19.mp4" 24 0
ffmpeg -y -loglevel error -i "$OUT/wing-c_crf19.mp4" -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p -c:a copy -movflags +faststart "$HERE/wing-c.mp4"
# 6. subtitles (.srt) from the same captions the picture burns in
python3 -c "import json;E=json.load(open('$HERE/events.json'));json.dump([{'t0':e['t'],'t1':e['t1'],'text':e['text']} for e in E['ev'] if e['type']=='cap'],open('$OUT/cues.json','w'))"
"$PY" core/render/srt.py "$OUT/cues.json" "$HERE/wing-c.srt"
# 7. poster
node core/render/still.mjs "$HERE" 44.2 --q nosub=1 --prefix pf_ --out "$OUT/t"
cp "$OUT/t/pf_44.2.jpg" "$HERE/poster.jpg"
echo "done: $HERE/wing-c.mp4"
