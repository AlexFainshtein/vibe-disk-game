@echo off
del /q public\* 2>nul
copy index.html public\
copy alex.html public\
copy eugene.html public\
copy main.js public\
copy state.js public\
copy playfield.js public\
copy alex-physics.js public\
copy alex-targets.js public\
copy alex-bumper.js public\
copy alex-trail.js public\
copy alex-pause.js public\
copy og-preview.png public\
copy controller-spring-drag.js public\
copy eugene-physics.js public\
copy eugene-bricks.js public\
copy eugene-mallet.js public\
copy eugene-handedness.js public\
copy eugene-config.js public\
copy render.js public\
copy input.js public\
copy sound.js public\
copy controls.js public\
copy style.css public\
if not exist public\Zen1 mkdir public\Zen1
for %%f in (zen1\*) do copy /y %%f public\Zen1\
if "%1"=="" (
  firebase deploy
) else (
  firebase deploy --project %1
)
