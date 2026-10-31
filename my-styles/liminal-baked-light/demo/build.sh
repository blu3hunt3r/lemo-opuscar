#!/bin/sh
# Liminal Found Footage · Baked Light — rebuild the demo film "Wing C".
# Copies this folder to $OUT/wing-c and builds there (this folder is never written to). QUICK=1 for a few-minute smoke test.
set -e
LIB=${LIB:-/home/user/lemo-opuscar}
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:-$LIB/films/wing-c-build}   # must be inside $LIB: the bake page loads three.js relative to the library's web root
[ -f "$LIB/core/render/video.mjs" ] || { echo "set LIB to the Lemo-Opuscar library folder"; exit 1; }
mkdir -p "$OUT/wing-c"
( cd "$HERE" && tar cf - --exclude=build.sh . ) | ( cd "$OUT/wing-c" && tar xf - )
LIB="$LIB" OUT="$OUT/wing-c/out" sh "$OUT/wing-c/film.sh"
