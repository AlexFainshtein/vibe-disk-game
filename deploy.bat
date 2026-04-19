@echo off
del /q public\* 2>nul
copy index.html public\
copy main.js public\
copy state.js public\
copy physics.js public\
copy render.js public\
copy input.js public\
copy sound.js public\
copy controls.js public\
copy style.css public\
firebase deploy
