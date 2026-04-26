import { canvas } from './state.js';

// Playfield primitives shared across game variants: the disk, the bar at the bottom,
// the spring anchor, recent-disk-position history for lag-compensated hit detection,
// and a debug click marker. Sizes recompute on canvas resize.
//
// state.js owns the canvas resize itself (loaded first because we import from it),
// so by the time this module's resize listener fires, canvas.width/height are current.

export const DISK_RADIUS_FRACTION = 1/10; // fraction of the shorter canvas dimension
const BAR_HEIGHT_FRACTION = 1/22;          // fraction of canvas height

const initialBarHeight = canvas.height * BAR_HEIGHT_FRACTION;
const initialBarY = document.body.dataset.player === 'eugene'
  ? canvas.height - initialBarHeight
  : canvas.height * 0.85;

export const disk = {
  x: canvas.width/2,
  y: canvas.height/2,
  r: Math.min(canvas.width, canvas.height) * DISK_RADIUS_FRACTION,
  vx: 0,
  vy: 0,
  color: '#ffb86b',
  glass: false
};

export const bar = {
  y: initialBarY,
  prevY: initialBarY,
  vy: 0,
  height: initialBarHeight,
  color: '#88aacc',
  dragging: false
};

// spring anchor: the point the disk is pulled toward
export const anchor = {
  active: false,
  x: 0,
  y: 0,
  prevX: 0,
  prevY: 0
};

// debug: hit detection state
export const clickMarker = {
  active: false,
  hit: false
};

// recent disk positions for lag-compensated hit detection
const HISTORY_SIZE = 5;
export const diskHistory = [];
export function recordDiskPosition(){
  diskHistory.push({x: disk.x, y: disk.y});
  if(diskHistory.length > HISTORY_SIZE) diskHistory.shift();
}

window.addEventListener('resize', ()=>{
  disk.r = Math.min(canvas.width, canvas.height) * DISK_RADIUS_FRACTION;
  bar.height = canvas.height * BAR_HEIGHT_FRACTION;
  if(document.body.dataset.player === 'eugene'){
    bar.y = canvas.height - bar.height;
    bar.prevY = bar.y;
  }
}, {passive:true});
