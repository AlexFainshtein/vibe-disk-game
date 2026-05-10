@echo off
if not exist public mkdir public
del /q public\* 2>nul
if exist public\Alex rmdir /s /q public\Alex
if exist public\Alex1 rmdir /s /q public\Alex1
if exist public\Eugene rmdir /s /q public\Eugene
if exist public\Zen1 rmdir /s /q public\Zen1
if exist public\game2 rmdir /s /q public\game2
copy index.html public\
copy main.js public\
copy state.js public\
copy playfield.js public\
copy og-preview.png public\
copy controller-spring-drag.js public\
copy render.js public\
copy input.js public\
copy sound.js public\
copy controls.js public\
copy style.css public\
mkdir public\Alex
for %%f in (Alex\*) do copy /y %%f public\Alex\
mkdir public\Alex1
for %%f in (Alex1\*) do copy /y %%f public\Alex1\
mkdir public\Eugene
for %%f in (Eugene\*) do copy /y %%f public\Eugene\
mkdir public\Zen1
for %%f in (Zen1\*) do copy /y %%f public\Zen1\
mkdir public\game2
for %%f in (game2\*) do copy /y %%f public\game2\
if "%1"=="" (
  firebase deploy
) else (
  firebase deploy --project %1
)
