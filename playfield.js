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
  ? canvas.height - initialBarHeight   // Eugene: bar at the bottom (acts as floor)
  : initialBarHeight;                   // Alex:   inset one bar-height from the top so it
                                        //         reads as a floating object, not screen chrome

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
  dragging: false,
  // Layout determines which side of the bar the disk lives on (and therefore
  // how the bar-drag clamp works). Default 'bottom' = disk above bar (Eugene
  // style); variants set this to 'top' (Alex style) at module load.
  layout: 'bottom'
};

// Clamp a candidate bar.y to the legal range for the current layout.
// 'bottom' layout (Eugene): disk lives above bar -> leave 2*disk.r above the bar.
// 'top'    layout (Alex):   disk lives below bar -> leave 2*disk.r below the bar.
export function clampBarY(newBarY){
  if(bar.layout === 'top'){
    const maxBarY = canvas.height - bar.height - disk.r * 2;
    return Math.max(0, Math.min(maxBarY, newBarY));
  }
  const minBarY = disk.r * 2;
  return Math.max(minBarY, Math.min(canvas.height - bar.height, newBarY));
}

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
  } else {
    // re-clamp the user-dragged bar position in case resize made it invalid
    bar.y = clampBarY(bar.y);
    bar.prevY = bar.y;
  }
}, {passive:true});
