import { canvas, renderExtras } from '../state.js';
import { diskBody, toPx } from './zen1-physics.js';

const MAX_POINTS = 16;
const TRAIL_WIDTH = 2;

const TRAIL_ALPHA = 0.4;

const PASTEL_COLORS = [
  'rgb(180, 180, 180)',   // grey (default)
  'rgb(255, 179, 186)',   // pink
  'rgb(186, 225, 255)',   // sky blue
  'rgb(186, 255, 201)',   // mint
  'rgb(255, 223, 186)',   // peach
  'rgb(232, 186, 255)',   // lavender
  'rgb(255, 255, 186)',   // yellow
  'rgb(201, 241, 255)',   // cyan
  'rgb(255, 209, 220)',   // rose
];

let colorIndex = 0;

const positions = [];

let offscreen = null;
let offCtx    = null;

let initialized = false;

function ensureOffscreen(){
  if(offscreen && offscreen.width === canvas.width && offscreen.height === canvas.height) return;
  offscreen        = document.createElement('canvas');
  offscreen.width  = canvas.width;
  offscreen.height = canvas.height;
  offCtx           = offscreen.getContext('2d');
  positions.length = 0; // break path so resize doesn't connect mismatched coords
}

function drawTrail(c){
  if(!offscreen) return;
  c.globalAlpha = TRAIL_ALPHA;
  c.drawImage(offscreen, 0, 0);
  c.globalAlpha = 1;
}

function init(){
  if(initialized) return;
  initialized = true;
  renderExtras.push(drawTrail);
  document.getElementById('resetDisk')?.addEventListener('click', resetTrail);
}

export function tickTrail(){
  if(!initialized) init();
  ensureOffscreen();
  const pos = diskBody.getPosition();
  const cur = { x: toPx(pos.x), y: toPx(pos.y) };

  if(positions.length > 0){
    const prev = positions[positions.length - 1];
    offCtx.strokeStyle = PASTEL_COLORS[colorIndex];
    offCtx.lineWidth   = TRAIL_WIDTH;
    offCtx.lineCap  = 'butt';
    offCtx.beginPath();
    offCtx.moveTo(prev.x, prev.y);
    offCtx.lineTo(cur.x, cur.y);
    offCtx.stroke();
  }

  positions.push(cur);
  if(positions.length > MAX_POINTS) positions.shift();
}

export function pauseTrail(){
  positions.length = 0; // forget last position so no jump-line after grab
}

export function resetTrail(){
  positions.length = 0;
  ensureOffscreen();
  offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
}

export function cycleTrailColor(){
  colorIndex = (colorIndex + 1) % PASTEL_COLORS.length;
}
