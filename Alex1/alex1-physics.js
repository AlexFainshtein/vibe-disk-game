// Alex1: minimal sample — disk auto-drifts and bounces off the canvas edges.
// No bar, no spring drag, no features yet. Placeholder for the next experiment.
import { canvas } from '../state.js';
import { disk, bar } from '../playfield.js';

bar.hidden = true;

disk.vx = 200;
disk.vy = 140;

export function update(dt){
  disk.x += disk.vx * dt;
  disk.y += disk.vy * dt;

  if(disk.x - disk.r < 0){ disk.x = disk.r; disk.vx = -disk.vx; }
  if(disk.x + disk.r > canvas.width){ disk.x = canvas.width - disk.r; disk.vx = -disk.vx; }
  if(disk.y - disk.r < 0){ disk.y = disk.r; disk.vy = -disk.vy; }
  if(disk.y + disk.r > canvas.height){ disk.y = canvas.height - disk.r; disk.vy = -disk.vy; }
}
