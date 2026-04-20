import { canvas, disk, bar } from './state.js';

export function initControls(){
  document.getElementById('resetDisk').addEventListener('click', ()=>{
    bar.y = canvas.height * 0.85;
    bar.prevY = bar.y;
    bar.vy = 0;
    disk.x = canvas.width / 2;
    disk.y = (bar.y - disk.r) / 2;
    disk.vx = 0;
    disk.vy = 0;
  });
}
