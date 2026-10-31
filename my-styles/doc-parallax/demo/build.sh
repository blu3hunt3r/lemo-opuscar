#!/bin/sh
# Documentary Parallax — rebuild the demo film "Endurance".
# Copies this folder to $OUT/endurance and builds there (this folder is never written to). QUICK=1 for a few-minute smoke test.
set -e
LIB=${LIB:-/home/user/lemo-opuscar}
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:-$LIB/films/endurance-build}
[ -f "$LIB/core/render/video.mjs" ] || { echo "set LIB to the Lemo-Opuscar library folder"; exit 1; }
mkdir -p "$OUT/endurance"
( cd "$HERE" && tar cf - --exclude=build.sh . ) | ( cd "$OUT/endurance" && tar xf - )
LIB="$LIB" OUT="$OUT/endurance/out" sh "$OUT/endurance/film.sh"
