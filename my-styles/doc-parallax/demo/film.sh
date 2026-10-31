#!/bin/sh
# Endurance (Documentary Parallax demo): build the film in this folder.  LIB=<library> OUT=<renders> sh film.sh   (QUICK=1: layers, events, sound and six stills; no video)
# Steps: three r187 + fonts → depth model + Python venv → photos → depth layers → events → sound → frames → mux (−14 LUFS, grain 3) → poster
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=${LIB:-/home/user/lemo-opuscar}
OUT=${OUT:-$HERE/out}
WORKERS=${WORKERS:-4}
export LIB
[ -f "$LIB/core/render/video.mjs" ] || { echo "set LIB to the Lemo-Opuscar library folder"; exit 1; }
mkdir -p "$OUT"
# 0. three.js r187 and the fonts (OFL, from npm)
[ -f "$HERE/node_modules/three/package.json" ] || (cd "$HERE" && npm i --silent three@0.187.0 @fontsource/inter @fontsource/ibm-plex-mono @fontsource/cormorant-garamond)
F="$HERE/node_modules/@fontsource"; mkdir -p "$HERE/fonts"
cp "$F/inter/files/inter-latin-500-normal.woff2" "$HERE/fonts/Inter-500.woff2"
cp "$F/inter/files/inter-latin-800-normal.woff2" "$HERE/fonts/Inter-800.woff2"
cp "$F/cormorant-garamond/files/cormorant-garamond-latin-500-normal.woff2" "$HERE/fonts/Cormorant-500.woff2"
cp "$F/cormorant-garamond/files/cormorant-garamond-latin-600-italic.woff2" "$HERE/fonts/Cormorant-600i.woff2"
cp "$F/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2" "$HERE/fonts/PlexMono-500.woff2"
# 1. depth model (Depth Anything V2 Small, Apache-2.0, ONNX) and the Python tools for tools/layers.py
mkdir -p "$HERE/models"
[ -f "$HERE/models/depth_anything_v2_small.onnx" ] || curl -sSL -o "$HERE/models/depth_anything_v2_small.onnx" https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx
[ -x "$HERE/.venv/bin/python" ] || { python3 -m venv "$HERE/.venv" && "$HERE/.venv/bin/pip" install -q onnxruntime numpy pillow scipy; }
PY="$HERE/.venv/bin/python"
# 2. the public-domain photos (assets/raw, see SOURCES.md) → depth bands in assets/tex (crops trim each print's border)
"$PY" -I "$HERE/tools/layers.py" "$HERE" p1 --crop 0.02,0.02,0.025,0.01
"$PY" -I "$HERE/tools/layers.py" "$HERE" p3 --crop 0.03,0.02,0.02,0.045 --bands 0.14,0.63
"$PY" -I "$HERE/tools/layers.py" "$HERE" p6 --crop 0.015,0.025,0.02,0.015
"$PY" -I "$HERE/tools/layers.py" "$HERE" portrait --crop 0.01,0.02,0.025,0.01 --blur 1.6 --bands 0.30
cp "$HERE/assets/raw/page.jpg" "$HERE/assets/tex/page.jpg"
cd "$LIB"
# 3. the page's timeline → events.json (sound cues)
node core/render/events.mjs "$HERE"
# 4. sound: score + effects from events.json → $OUT/mix.wav (the library's venv: soundfile, scipy; samples: VSCO 2 CE, CC0, and Salamander piano, CC BY 3.0)
[ -d core/audio/instruments/vsco2ce ] || sh tools/fetch.sh instruments vsco2ce
[ -d core/audio/instruments/salamander ] || sh tools/fetch.sh instruments salamander
OUT="$OUT" "$LIB/.venv/bin/python" -I "$HERE/mix.py"
if [ -n "$QUICK" ]; then node core/render/still.mjs "$HERE" 2.9 5.6 11.0 16.6 23.6 28.6 --out "$OUT/quick" && echo "quick check done: $OUT/quick" && exit 0; fi
# 5. frames → video
node core/render/video.mjs "$HERE" --fps 24 --workers "$WORKERS" --out "$OUT/video.mp4"
# 6. mux (two-pass loudnorm −14 LUFS, film grain 3), then a smaller final encode
sh core/render/mux.sh "$OUT/video.mp4" "$OUT/mix.wav" "$OUT/endurance_crf19.mp4" 24 3
ffmpeg -y -loglevel error -i "$OUT/endurance_crf19.mp4" -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -c:a copy -movflags +faststart "$OUT/endurance.mp4"
# 7. poster
node core/render/still.mjs "$HERE" 28.6 --prefix pf_ --out "$OUT/t"
cp "$OUT/t/pf_28.6.jpg" "$OUT/poster.jpg"
echo "done: $OUT/endurance.mp4"
