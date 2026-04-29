import { canvas, renderExtras, inputHooks } from '../state.js';

const BUMPER_RADIUS_FRACTION = 1/6;
const BUMPER_COLOR = '#a0522d';

function computeBumperRadius(){
  return Math.min(canvas.width, canvas.height) * BUMPER_RADIUS_FRACTION;
}

function initialPos(){
  return { x: canvas.width / 2, y: canvas.height * 0.95 };
}

export const bumper = {
  active: true,
  x: canvas.width  / 2,
  y: canvas.height * 0.95,
  r: computeBumperRadius()
};

window.addEventListener('resize', () => {
  bumper.r = computeBumperRadius();
  bumper.x = Math.max(bumper.r, Math.min(canvas.width  - bumper.r, bumper.x));
  bumper.y = Math.max(bumper.r, Math.min(canvas.height - bumper.r, bumper.y));
}, { passive: true });

document.getElementById('resetDisk')?.addEventListener('click', () => {
  const p = initialPos();
  bumper.x = p.x;
  bumper.y = p.y;
});

let firstHitPending = true;
let firstHitSinceLastTick = false;

function drawBumper(c){
  c.beginPath();
  c.fillStyle = BUMPER_COLOR;
  c.arc(bumper.x, bumper.y, bumper.r, 0, Math.PI * 2);
  c.fill();
}
renderExtras.push(drawBumper);

let dragging = false;
let initialized = false;

function init(){
  if(initialized) return;
  initialized = true;

  const prevDown = inputHooks.emptyDown;
  inputHooks.emptyDown = (x, y) => {
    const dx = x - bumper.x, dy = y - bumper.y;
    if(dx*dx + dy*dy <= bumper.r * bumper.r){
      dragging = true;
      return true;
    }
    if(prevDown) return prevDown(x, y);
    return false;
  };

  const prevMove = inputHooks.emptyMove;
  inputHooks.emptyMove = (x, y) => {
    if(dragging){ bumper.x = x; bumper.y = y; }
    else if(prevMove) prevMove(x, y);
  };

  const prevUp = inputHooks.emptyUp;
  inputHooks.emptyUp = () => {
    dragging = false;
    if(prevUp) prevUp();
  };
}

export function notifyBumperHit(){
  if(firstHitPending){
    firstHitPending = false;
    firstHitSinceLastTick = true;
  }
}

export function tickBumper(){
  if(!initialized) init();
  const events = {
    firstHit: firstHitSinceLastTick,
    placed: false,
    removed: false,
    removedAfterHit: false
  };
  firstHitSinceLastTick = false;
  return events;
}
