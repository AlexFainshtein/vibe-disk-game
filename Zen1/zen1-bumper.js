import { canvas, renderExtras, inputHooks } from '../state.js';
import { disk } from '../playfield.js';

const BUMPER_RADIUS_FRACTION = 1/6;
const BUMPER_COLOR = '#3a4a66';

function computeBumperRadius(){
  return Math.min(canvas.width, canvas.height) * BUMPER_RADIUS_FRACTION;
}

export const bumper = {
  active: false,
  x: 0,
  y: 0,
  r: computeBumperRadius()
};

window.addEventListener('resize', ()=>{ bumper.r = computeBumperRadius(); }, { passive: true });

let initialized = false;
let firstHitPending = false;
let hitDuringThisPlacement = false;
let firstHitSinceLastTick = false;
let placedSinceLastTick = false;
let removedSinceLastTick = false;
let removedAfterHitSinceLastTick = false;

function drawBumper(c){
  if(!bumper.active) return;
  c.beginPath();
  c.fillStyle = BUMPER_COLOR;
  c.arc(bumper.x, bumper.y, bumper.r, 0, Math.PI * 2);
  c.fill();
}

function place(x, y){
  bumper.active = true;
  bumper.x = x;
  bumper.y = y;
  firstHitPending = true;
  hitDuringThisPlacement = false;
  placedSinceLastTick = true;
}

function remove(){
  if(!bumper.active) return;
  bumper.active = false;
  firstHitPending = false;
  removedSinceLastTick = true;
  if(hitDuringThisPlacement) removedAfterHitSinceLastTick = true;
  hitDuringThisPlacement = false;
}

function init(){
  if(initialized) return;
  initialized = true;

  inputHooks.emptyDown = (x, y) => {
    if(bumper.active){
      const dx = x - bumper.x;
      const dy = y - bumper.y;
      if(dx*dx + dy*dy <= bumper.r * bumper.r){
        remove();
        return false;
      }
      remove();
      place(x, y);
      return false;
    }
    place(x, y);
    return false;
  };

  document.getElementById('resetDisk')?.addEventListener('click', remove);

  renderExtras.push(drawBumper);
}

export function notifyBumperHit(){
  hitDuringThisPlacement = true;
  if(firstHitPending){
    firstHitPending = false;
    firstHitSinceLastTick = true;
  }
}

export function tickBumper(){
  if(!initialized) init();
  const events = {
    firstHit:        firstHitSinceLastTick,
    placed:          placedSinceLastTick,
    removed:         removedSinceLastTick,
    removedAfterHit: removedAfterHitSinceLastTick
  };
  firstHitSinceLastTick = false;
  placedSinceLastTick = false;
  removedSinceLastTick = false;
  removedAfterHitSinceLastTick = false;
  return events;
}
