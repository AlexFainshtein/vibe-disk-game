import { canvas, disk, params, renderExtras, inputHooks } from './state.js';
import { playKnock } from './sound.js';

// Bumper radius is a fraction of the shorter canvas dimension so it stays right-sized across phones / orientations.
const BUMPER_RADIUS_FRACTION = 1/6;
const BUMPER_COLOR = '#dca96d';  // warm tan, contrasts with the disk's orange
const MAX_BOUNCE_SPEED = 1200;   // matches alex-physics.js for consistent knock intensity

function computeBumperRadius(){
  return Math.min(canvas.width, canvas.height) * BUMPER_RADIUS_FRACTION;
}

const bumper = {
  active: false,
  x: 0,
  y: 0,
  r: computeBumperRadius()
};

window.addEventListener('resize', ()=>{ bumper.r = computeBumperRadius(); }, { passive: true });

let initialized = false;
let firstHitPending = false;            // true between bumper placement and the first disk-bumper collision
let hitDuringThisPlacement = false;     // sticky flag: any collision happened during the current placement
let firstHitSinceLastTick = false;      // event flag: first collision happened during this tick
let placedSinceLastTick = false;        // event flag: bumper just placed or relocated by user input
let removedSinceLastTick = false;       // event flag: bumper went from active to inactive (any cause)
let removedAfterHitSinceLastTick = false; // event flag: removal followed at least one collision (trajectory was actually altered)

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
        // tap on the bumper → remove it
        remove();
        return false;
      }
      // tap on empty space while a bumper exists → relocate (old removed, new placed)
      remove();
      place(x, y);
      return false;
    }
    place(x, y);
    return false; // bumper is static; no need to capture pointer for move/up
  };
  // emptyMove and emptyUp intentionally not registered — bumper does not follow finger and persists after lift

  // clear the bumper whenever the Reset button is clicked (manual or programmatic, e.g. idle auto-reset)
  document.getElementById('resetDisk')?.addEventListener('click', remove);

  renderExtras.push(drawBumper);
}

function checkCollision(){
  if(!bumper.active) return;
  const dx = disk.x - bumper.x;
  const dy = disk.y - bumper.y;
  const dist = Math.hypot(dx, dy);
  const minDist = disk.r + bumper.r;
  if(dist >= minDist || dist <= 0) return;

  const nx = dx / dist;
  const ny = dy / dist;
  // push the disk out along the normal so it just touches the bumper
  disk.x = bumper.x + nx * minDist;
  disk.y = bumper.y + ny * minDist;
  // reflect velocity along the normal only if the disk was approaching
  const vDotN = disk.vx * nx + disk.vy * ny;
  if(vDotN >= 0) return;
  const factor = (1 + params.bounce) * vDotN;
  disk.vx -= factor * nx;
  disk.vy -= factor * ny;
  const intensity = Math.min(Math.abs(vDotN) / MAX_BOUNCE_SPEED, 1);
  playKnock(intensity);
  hitDuringThisPlacement = true;
  if(firstHitPending){
    firstHitPending = false;
    firstHitSinceLastTick = true;
  }
}

export function tickBumper(){
  if(!initialized) init();
  checkCollision();
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
