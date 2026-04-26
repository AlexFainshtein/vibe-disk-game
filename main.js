import { canvas } from './state.js';
import { disk, recordDiskPosition } from './playfield.js';
import { draw } from './render.js';
import { setupInput } from './input.js';
import { initControls } from './controls.js';
import { update as alexUpdate } from './alex-physics.js';
import { update as eugeneUpdate } from './eugene-physics.js';

const player = document.body.dataset.player ?? 'alex';
const update = player === 'eugene' ? eugeneUpdate : alexUpdate;

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
