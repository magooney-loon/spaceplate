#!/bin/sh
# Transcode the engine sources (wav or mp3) to mono 48 kHz Opus (~64 kbps
# VBR), the same recipe the skybox sounds already use (see
# src/core/audio/GlobalAudio.svelte). Mono on purpose: every consumer is a
# PositionalAudio point source, and the PannerNode wants mono input anyway.
#
# Usage: sh scripts/convert-engine-opus.sh          (probe + convert)
#        sh scripts/convert-engine-opus.sh --probe  (probe only)

set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)/public/sounds/engine"

# wav is the usual raw material; mp3 covers sourced one-shots (gear_shift)
# that arrive already compressed. Sources are removed by hand after probing
# the result — only the .opus files ship.

echo "== probe (source) =="
for f in "$DIR"/*.wav "$DIR"/*.mp3; do
	[ -f "$f" ] || continue
	printf '%-24s ' "$(basename "$f")"
	ffprobe -v error -select_streams a:0 \
		-show_entries stream=sample_rate,channels,bits_per_sample \
		-show_entries format=duration \
		-of csv=p=0 "$f" | tr '\n' ' '
	echo
done

[ "$1" = "--probe" ] && exit 0

echo
echo "== convert =="
for f in "$DIR"/*.wav "$DIR"/*.mp3; do
	[ -f "$f" ] || continue
	out="${f%.*}.opus"
	ffmpeg -y -v error -i "$f" \
		-ac 1 -ar 48000 -c:a libopus -b:a 64k \
		"$out"
done

echo
echo "== probe (opus) =="
for f in "$DIR"/*.opus; do
	printf '%-24s ' "$(basename "$f")"
	ffprobe -v error -select_streams a:0 \
		-show_entries stream=sample_rate,channels \
		-show_entries format=duration \
		-of csv=p=0 "$f" | tr '\n' ' '
	echo
done

echo
echo "== sizes =="
du -sh "$DIR"
ls -l "$DIR" | awk '{print $5, $9}'
