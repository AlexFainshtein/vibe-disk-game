#!/usr/bin/env bash
set -euo pipefail

rm -rf public
mkdir -p public/Alex public/Alex1 public/Eugene public/Zen1 public/game2

cp index.html main.js state.js playfield.js og-preview.png \
   controller-spring-drag.js render.js input.js sound.js controls.js style.css \
   public/

cp Alex/* public/Alex/
cp Alex1/* public/Alex1/
cp Eugene/* public/Eugene/
cp Zen1/* public/Zen1/
cp game2/* public/game2/

if [ $# -eq 0 ]; then
  firebase deploy
else
  firebase deploy --project "$1"
fi
