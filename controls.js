import { canvas, disk } from './state.js';

export function initControls(){
  document.getElementById('resetDisk').addEventListener('click', ()=>{
    disk.x = canvas.width / 2;
    disk.y = canvas.height / 2;
    disk.vx = 0;
    disk.vy = 0;
  });
}
