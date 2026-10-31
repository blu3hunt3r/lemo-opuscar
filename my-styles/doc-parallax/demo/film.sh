#!/bin/sh
# Endurance v2 (Documentary Parallax demo): build the film in this folder.  LIB=<library> OUT=<renders> sh film.sh
# QUICK=1: layers, masks, events, sound and six stills; no video.
# Steps: three r187 + fonts → models (depth, inpainting) + Python venv → photo layers, water masks, map and paper textures → events →
#        sound → frames → mux (−14 LUFS, grain 3) → poster
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=${LIB:-/home/user/lemo-opuscar}
OUT=${OUT:-$HERE/out}
WORKERS=${WORKERS:-3}
export LIB
[ -f "$LIB/core/render/video.mjs" ] || { echo "set LIB to the Lemo-Opuscar library folder"; exit 1; }
mkdir -p "$OUT" "$HERE/assets/tex" "$HERE/models"
# 0. three.js r187 and the fonts (OFL, from npm)
[ -f "$HERE/node_modules/three/package.json" ] || (cd "$HERE" && npm i --silent three@0.187.0 @fontsource/inter @fontsource/ibm-plex-mono @fontsource/cormorant-garamond)
F="$HERE/node_modules/@fontsource"; mkdir -p "$HERE/fonts"
cp "$F/inter/files/inter-latin-500-normal.woff2" "$HERE/fonts/Inter-500.woff2"
cp "$F/inter/files/inter-latin-800-normal.woff2" "$HERE/fonts/Inter-800.woff2"
cp "$F/cormorant-garamond/files/cormorant-garamond-latin-500-normal.woff2" "$HERE/fonts/Cormorant-500.woff2"
cp "$F/cormorant-garamond/files/cormorant-garamond-latin-600-italic.woff2" "$HERE/fonts/Cormorant-600i.woff2"
cp "$F/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2" "$HERE/fonts/PlexMono-500.woff2"
# 1. models used offline (Apache-2.0): Depth Anything V2 Small (depth), LaMa (inpainting); Python tools
[ -f "$HERE/models/depth_anything_v2_small.onnx" ] || curl -sSL -o "$HERE/models/depth_anything_v2_small.onnx" https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx
[ -f "$HERE/models/lama_fp32.onnx" ] || curl -sSL -o "$HERE/models/lama_fp32.onnx" https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx
[ -x "$HERE/.venv/bin/python" ] || { python3 -m venv "$HERE/.venv" && "$HERE/.venv/bin/pip" install -q onnxruntime numpy pillow scipy; }
PY="$HERE/.venv/bin/python"
# 2. the public-domain photographs (assets/raw, see SOURCES.md / SOURCES-v2.md) → depth layers with inpainted fills; water masks
"$PY" -I "$HERE/tools/layers.py" "$HERE" p1 --crop 0.02,0.02,0.025,0.01 --res 770 --bands 0.16,0.66
"$PY" -I "$HERE/tools/layers.py" "$HERE" colour2 --crop 0.012,0.015,0.012,0.012 --res 770
"$PY" -I "$HERE/tools/layers.py" "$HERE" p3 --crop 0.03,0.02,0.02,0.045 --bands 0.14,0.63
"$PY" -I "$HERE/tools/layers.py" "$HERE" p5 --crop 0.02,0.03,0.03,0.02
"$PY" -I "$HERE/tools/layers.py" "$HERE" p6_hi --crop 0.03,0.12,0.03,0.09 --res 770
"$PY" -I "$HERE/tools/flowmask.py" "$HERE" p5 --disp 0,1 --lum 0.5,1 --rect 0.3,0.2,1,0.5 --rect 0,0.5,1,1 --feather 14 --inset 14
"$PY" -I "$HERE/tools/flowmask.py" "$HERE" p6_hi --disp 0.15,0.62 --lum 0.4,1 --rect 0,0.26,0.83,0.8 --rect 0.83,0.26,1,0.37 --rect 0.83,0.62,1,0.8 --feather 14 --inset 14
# 3. the documents: the 1919 map as it is; the newspaper at half size for the desk; the fallback paper map
cp "$HERE/assets/raw/map1919.jpg" "$HERE/assets/tex/map1919.jpg"
"$PY" -I -c "from PIL import Image; Image.MAX_IMAGE_PIXELS=None; im=Image.open('$HERE/assets/raw/news.jpg').convert('L'); im.resize((im.width//2, im.height//2), Image.LANCZOS).convert('RGB').save('$HERE/assets/tex/news_desk.jpg', quality=90)"
"$PY" -I "$HERE/tools/papermap.py" "$HERE"
cd "$LIB"
# 4. the page's timeline → events.json (sound cues)
node core/render/events.mjs "$HERE"
# 5. sound: score + effects from events.json → $OUT/mix.wav (the library's venv; samples: VSCO 2 CE, CC0, and Salamander piano, CC BY 3.0)
[ -d core/audio/instruments/vsco2ce ] || sh tools/fetch.sh instruments vsco2ce
[ -d core/audio/instruments/salamander ] || sh tools/fetch.sh instruments salamander
OUT="$OUT" "$LIB/.venv/bin/python" -I "$HERE/mix.py"
if [ -n "$QUICK" ]; then node core/render/still.mjs "$HERE" 1.2 5.6 7.4 12.4 21.0 25.8 --out "$OUT/quick" && echo "quick check done: $OUT/quick" && exit 0; fi
# 6. frames → video. tools/frames.mjs renders with the library's page tools but allows 180 s per frame and resumes after a stop
#    (run film.sh again: frames already in $OUT/frames are kept); on a 4-core CPU without a GPU this takes about 80 minutes
LIB="$LIB" node "$HERE/tools/frames.mjs" "$HERE" --out "$OUT/frames" --fps 24 --workers "$WORKERS" --timeout 180
ffmpeg -y -loglevel error -framerate 24 -i "$OUT/frames/f_%05d.jpg" -c:v libx264 -preset medium -crf 14 -pix_fmt yuv420p "$OUT/video.mp4"
# 7. mux (two-pass loudnorm −14 LUFS, film grain 3), then a smaller final encode
sh core/render/mux.sh "$OUT/video.mp4" "$OUT/mix.wav" "$OUT/endurance_crf19.mp4" 24 3
ffmpeg -y -loglevel error -i "$OUT/endurance_crf19.mp4" -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -c:a copy -movflags +faststart "$OUT/endurance.mp4"
# 8. poster
node core/render/still.mjs "$HERE" 5.6 --prefix pf_ --out "$OUT/t"
cp "$OUT/t/pf_5.6.jpg" "$OUT/poster.jpg"
echo "done: $OUT/endurance.mp4"
