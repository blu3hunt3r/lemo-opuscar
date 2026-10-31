#!/bin/sh
# Review pass: stills at the beats → contact sheet (run from the library root): sh films/wing-c/tools/review.sh [out_dir] [extra --q]
HERE=$(cd "$(dirname "$0")/.." && pwd); O=${1:-$HERE/out/review}; Q=${2:-}
TS="1.5 3.0 5.5 9.0 11.8 13.0 15.0 17.0 19.0 21.0 22.5 24.5 26.5 27.5 29.0 30.8 33.0 35.0 37.0 38.5 39.8 41.0 42.0 42.8 43.5 44.2 45.5 47.0 49.5 51.5 53.0 54.5 56.0 57.5 58.8 60.2"
node core/render/still.mjs "$HERE" $TS --out "$O" ${Q:+--q "$Q"} 2>&1 | grep -E "jpg|error|Error" | tail -3
.venv/bin/python core/render/sheet.py "$O/sheet.jpg" $(for t in $TS; do echo "$O/t_$t.jpg"; done) --cols 6 --w 400
echo "$O/sheet.jpg"
