import { canvas } from './state.js';
import { disk, recordDiskPosition } from './playfield.js';
import { draw } from './render.js';
import { setupInput } from './input.js';
import { initControls } from './controls.js';

// Dynamic import: only the active variant's physics + its feature modules are
// fetched and executed. Top-level await is supported in all modern browsers and
// keeps the rest of this file linear.
const player = document.body.dataset.player ?? 'alex';
const physicsPaths = {
  alex:   './Alex/alex-physics.js',
  alex1:  './Alex1/alex1-physics.js',
  alex2:  './Alex2/alex2-physics.js',
  eugene: './Eugene/eugene-physics.js',
};
const physicsModule = await import(physicsPaths[player] ?? physicsPaths.alex);
const update = physicsModule.update;

let lastTime = performance.now();

function loop(t){
  const dt = Math.min(0.033, (t - lastTime)/1000);
  lastTime = t;
  update(dt);
  recordDiskPosition();
  draw();
  requestAnimationFrame(loop);
}

window.addEventListener('load', ()=>{
  disk.x = canvas.width/2;
  disk.y = canvas.height/2;
});

setupInput();
initControls();
requestAnimationFrame(loop);
