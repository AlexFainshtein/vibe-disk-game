@echo off
del /q public\* 2>nul
copy index.html public\
copy alex.html public\
copy eugene.html public\
copy main.js public\
copy state.js public\
copy alex-physics.js public\
copy eugene-physics.js public\
copy render.js public\
copy input.js public\
copy sound.js public\
copy controls.js public\
copy style.css public\
if "%1"=="" (
  firebase deploy
) else (
  firebase deploy --project %1
)
