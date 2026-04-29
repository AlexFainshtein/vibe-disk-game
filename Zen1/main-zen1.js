import { update } from './zen1-physics.js';
import { draw } from './zen1-render.js';
import { setupInput } from './zen1-input.js';
import { initControls } from '../controls.js';

let lastTime = performance.now();

function loop(t){
  const dt = Math.min(0.033, (t - lastTime)/1000);
  lastTime = t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

setupInput();
initControls();
requestAnimationFrame(loop);
