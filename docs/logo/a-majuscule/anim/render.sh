#!/bin/bash
# ./render.sh <base> [durée_s]  →  <base>-1080x1080-clair.mp4, <base>-1920x1080-sombre.mp4, <base>-800.gif
# à partir de <base>.svg (clair, jaune or) et <base>-dark.svg (sombre, jaune vif).
set -e; cd "$(dirname "$0")"; B=$1; DUR=${2:-5.0}; TMP=/tmp/fr-$B; rm -rf $TMP
node capture.js $B.svg 1080 1080 '#FFFFFF' 900 $TMP/sq 30 $DUR >/dev/null &
node capture.js $B-dark.svg 1920 1080 '#0B1A20' 1400 $TMP/hd 30 $DUR >/dev/null &
node capture.js $B.svg 800 300 '#FFFFFF' 680 $TMP/gif 25 $DUR >/dev/null &
wait
ffmpeg -y -loglevel error -framerate 30 -i $TMP/sq/f%04d.png -c:v libx264 -pix_fmt yuv420p -crf 16 -movflags +faststart $B-1080x1080-clair.mp4
ffmpeg -y -loglevel error -framerate 30 -i $TMP/hd/f%04d.png -c:v libx264 -pix_fmt yuv420p -crf 16 -movflags +faststart $B-1920x1080-sombre.mp4
ffmpeg -y -loglevel error -framerate 25 -i $TMP/gif/f%04d.png -vf "split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a" -loop 0 $B-800.gif
echo "$B ok"
