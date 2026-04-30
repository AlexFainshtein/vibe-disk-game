import { canvas, renderExtras, inputHooks } from '../state.js';

const BUMPER_RADIUS_FRACTION = 1/6;

function computeRadius(){
  return Math.min(canvas.width, canvas.height) * BUMPER_RADIUS_FRACTION;
}

const BAR_Y_FRACTION = 0.90;  // must match initialBarY() in zen1-bar.js

function defaultPositions(){
  const r = computeRadius();
  const y = canvas.height * BAR_Y_FRACTION - r;
  return [
    { x: canvas.width * 0.25, y },
    { x: canvas.width * 0.5,  y },
    { x: canvas.width * 0.75, y },
  ];
}

const BUMPER_DEFS = [
  { color: '#c0392b' },  // red
  { color: '#2471a3' },  // blue
  { color: '#27ae60' },  // green
];

const r = computeRadius();
const pos = defaultPositions();
export const bumpers = BUMPER_DEFS.map((def, i) => ({
  active: true,
  x: pos[i].x,
  y: pos[i].y,
  r,
  color: def.color,
}));


window.addEventListener('resize', () => {
  const newR   = computeRadius();
  const newPos = defaultPositions();
  bumpers.forEach((b, i) => {
    b.r = newR;
    b.x = Math.max(newR, Math.min(canvas.width  - newR, b.x));
    b.y = Math.max(newR, Math.min(canvas.height - newR, b.y));
  });
}, { passive: true });

document.getElementById('resetDisk')?.addEventListener('click', () => {
  const pos = defaultPositions();
  bumpers.forEach((b, i) => { b.x = pos[i].x; b.y = pos[i].y; });
});

const firstHitPending       = bumpers.map(() => true);
const firstHitSinceLastTick = bumpers.map(() => false);

export function notifyBumperHit(index){
  if(firstHitPending[index]){
    firstHitPending[index]       = false;
    firstHitSinceLastTick[index] = true;
  }
}

function drawBumpers(c){
  bumpers.forEach(b => {
    c.beginPath();
    c.fillStyle = b.color;
    c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    c.fill();
  });
}
renderExtras.push(drawBumpers);

let onBumperGrabbed = null;
export function setOnBumperGrabbed(fn){ onBumperGrabbed = fn; }

let draggingIndex = -1;
let grabOffsetX   = 0;
let grabOffsetY   = 0;
let initialized   = false;

function init(){
  if(initialized) return;
  initialized = true;

  const prevDown = inputHooks.emptyDown;
  inputHooks.emptyDown = (x, y) => {
    for(let i = 0; i < bumpers.length; i++){
      const b = bumpers[i];
      const dx = x - b.x, dy = y - b.y;
      if(dx*dx + dy*dy <= b.r * b.r){
        draggingIndex = i;
        grabOffsetX   = b.x - x;
        grabOffsetY   = b.y - y;
        if(onBumperGrabbed) onBumperGrabbed(i);
        return true;
      }
    }
    if(prevDown) return prevDown(x, y);
    return false;
  };

  const prevMove = inputHooks.emptyMove;
  inputHooks.emptyMove = (x, y) => {
    if(draggingIndex >= 0){
      bumpers[draggingIndex].x = x + grabOffsetX;
      bumpers[draggingIndex].y = y + grabOffsetY;
    } else if(prevMove) prevMove(x, y);
  };

  const prevUp = inputHooks.emptyUp;
  inputHooks.emptyUp = () => {
    draggingIndex = -1;
    if(prevUp) prevUp();
  };
}

export function tickBumper(){
  if(!initialized) init();
  const anyFirstHit = firstHitSinceLastTick.some(Boolean);
  firstHitSinceLastTick.fill(false);
  return {
    firstHit:        anyFirstHit,
    placed:          false,
    removed:         false,
    removedAfterHit: false,
  };
}
