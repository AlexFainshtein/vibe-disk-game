import { disk, renderExtras } from './state.js';

const TRAIL_COLOR = 'rgba(255, 255, 255, 0.28)';
const TRAIL_WIDTH = 1.5;

// trail is an array of segments; each segment is an array of {x, y}.
// Segments let us pause recording (e.g. while the user is holding the disk) and
// resume later without drawing a straight line between the pre-pause and post-resume points.
const trail = [];
let currentSegment = null;
let initialized = false;

function drawTrail(c){
  c.strokeStyle = TRAIL_COLOR;
  c.lineWidth = TRAIL_WIDTH;
  for(const segment of trail){
    if(segment.length < 2) continue;
    c.beginPath();
    c.moveTo(segment[0].x, segment[0].y);
    for(let i = 1; i < segment.length; i++){
      c.lineTo(segment[i].x, segment[i].y);
    }
    c.stroke();
  }
}

function init(){
  if(initialized) return;
  initialized = true;
  renderExtras.push(drawTrail);
  // Trail is intentionally NOT cleared on Reset — the trajectory is the interesting pattern the user
  // wants to keep seeing after the disk has stopped.
}

export function tickTrail(){
  if(!initialized) init();
  if(!currentSegment){
    currentSegment = [];
    trail.push(currentSegment);
  }
  currentSegment.push({ x: disk.x, y: disk.y });
}

// Mark a break in the trail so the next recorded point starts a new segment.
// Used when the user grabs the disk: we don't want a straight line drawn between
// the pre-grab position and wherever the disk ends up after release.
export function pauseTrail(){
  currentSegment = null;
}

export function resetTrail(){
  trail.length = 0;
  currentSegment = null;
}
