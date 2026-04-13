import { canvas, disk } from './state.js';
import { update } from './physics.js';
import { draw } from './render.js';
import { setupInput } from './input.js';
import { initControls } from './controls.js';

let lastTime = performance.now();

function loop(t){
  const dt = Math.min(0.033, (t - lastTime)/1000);
  lastTime = t;
  update(dt);
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
