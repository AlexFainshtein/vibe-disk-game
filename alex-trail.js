import { disk, renderExtras } from './state.js';

const TRAIL_COLOR = 'rgba(255, 255, 255, 0.28)';
const TRAIL_WIDTH = 1.5;

const trail = [];
let initialized = false;

function drawTrail(c){
  if(trail.length < 2) return;
  c.strokeStyle = TRAIL_COLOR;
  c.lineWidth = TRAIL_WIDTH;
  c.beginPath();
  c.moveTo(trail[0].x, trail[0].y);
  for(let i = 1; i < trail.length; i++){
    c.lineTo(trail[i].x, trail[i].y);
  }
  c.stroke();
}

function init(){
  if(initialized) return;
  initialized = true;
  renderExtras.push(drawTrail);
  // clear the trail whenever the Reset button is clicked (manual or programmatic, e.g. idle auto-reset)
  document.getElementById('resetDisk')?.addEventListener('click', resetTrail);
}

export function tickTrail(){
  if(!initialized) init();
  trail.push({ x: disk.x, y: disk.y });
}

export function resetTrail(){
  trail.length = 0;
}
