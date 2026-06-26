#!/usr/bin/env bash
set -euo pipefail

rm -rf public
mkdir -p public/Alex public/Alex1 public/Alex2 public/Eugene public/Zen1 public/game2

cp index.html main.js state.js playfield.js og-preview.png \
   controller-spring-drag.js render.js input.js sound.js controls.js style.css \
   public/

# Copy each variant folder's top-level files only — skip subdirectories like
# Alex2/tests and Alex2/artifacts (-type f also sidesteps space-in-name issues).
for d in Alex Alex1 Alex2 Eugene Zen1 game2; do
  find "$d" -maxdepth 1 -type f -exec cp {} "public/$d/" \;
done

if [ $# -eq 0 ]; then
  firebase deploy
else
  firebase deploy --project "$1"
fi
