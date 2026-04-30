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

// 0 = grey, 1 = grouped (all walls share one color), 2 = individual (each surface distinct)
let mode = 0;
let currentDrawColor = PASTEL_COLORS[0];
const surfaceColors = { wallTop: PASTEL_COLORS[0], wallLeft: PASTEL_COLORS[0], wallRight: PASTEL_COLORS[0], bar: PASTEL_COLORS[0], bumper: PASTEL_COLORS[0] };

function randomizeSurfaceColors(){
  const indices = [1, 2, 3, 4, 5, 6, 7, 8];
  for(let i = indices.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  if(mode === 1){
    const wallColor = PASTEL_COLORS[indices[0]];
    surfaceColors.wallTop   = wallColor;
    surfaceColors.wallLeft  = wallColor;
    surfaceColors.wallRight = wallColor;
    surfaceColors.bar       = PASTEL_COLORS[indices[1]];
    surfaceColors.bumper    = PASTEL_COLORS[indices[2]];
  } else {
    surfaceColors.wallTop   = PASTEL_COLORS[indices[0]];
    surfaceColors.wallLeft  = PASTEL_COLORS[indices[1]];
    surfaceColors.wallRight = PASTEL_COLORS[indices[2]];
    surfaceColors.bar       = PASTEL_COLORS[indices[3]];
    surfaceColors.bumper    = PASTEL_COLORS[indices[4]];
  }
}

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
  positions.length = 0;
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
    offCtx.strokeStyle = currentDrawColor;
    offCtx.lineWidth   = TRAIL_WIDTH;
    offCtx.lineCap     = 'butt';
    offCtx.beginPath();
    offCtx.moveTo(prev.x, prev.y);
    offCtx.lineTo(cur.x, cur.y);
    offCtx.stroke();
  }

  positions.push(cur);
  if(positions.length > MAX_POINTS) positions.shift();
}

export function addContactPoint(x, y){
  if(!initialized) init();
  ensureOffscreen();
  const cur = { x, y };
  if(positions.length > 0){
    const prev = positions[positions.length - 1];
    offCtx.strokeStyle = currentDrawColor;
    offCtx.lineWidth   = TRAIL_WIDTH;
    offCtx.lineCap     = 'butt';
    offCtx.beginPath();
    offCtx.moveTo(prev.x, prev.y);
    offCtx.lineTo(cur.x, cur.y);
    offCtx.stroke();
  }
  positions.push(cur);
  if(positions.length > MAX_POINTS) positions.shift();
}

export function pauseTrail(){
  positions.length = 0;
}

export function resetTrail(){
  positions.length = 0;
  ensureOffscreen();
  offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
}

export function cycleTrailColor(){
  mode = (mode + 1) % 3;
  currentDrawColor = PASTEL_COLORS[0]; // grey until first contact in dynamic modes
  if(mode > 0) randomizeSurfaceColors();
  resetTrail();
}

export function notifyContact(surface){
  if(mode === 0) return;
  currentDrawColor = surfaceColors[surface];
}
