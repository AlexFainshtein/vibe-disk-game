import { renderExtras } from './state.js';
import { disk } from './playfield.js';

const TRAIL_COLOR = 'rgba(255, 255, 255, 0.28)';
const TRAIL_WIDTH = 1.5;

// trail is an array of segments; each segment is { color, points: [{x, y}, ...] }.
// Segments let us pause recording (e.g. while the user is holding the disk) and
// resume later without drawing a straight line between the pre-pause and post-resume points.
// Per-segment color lets the throwaway "reverse" experiment paint a new color on top
// of the existing white trail (see setTrailColor in alex-physics.js).
const trail = [];
let currentSegment = null;
let nextSegmentColor = TRAIL_COLOR;
let initialized = false;

function drawTrail(c){
  c.lineWidth = TRAIL_WIDTH;
  for(const segment of trail){
    if(segment.points.length < 2) continue;
    c.strokeStyle = segment.color;
    c.beginPath();
    c.moveTo(segment.points[0].x, segment.points[0].y);
    for(let i = 1; i < segment.points.length; i++){
      c.lineTo(segment.points[i].x, segment.points[i].y);
    }
    c.stroke();
  }
}

function init(){
  if(initialized) return;
  initialized = true;
  renderExtras.push(drawTrail);
  // Trail is intentionally NOT cleared on Reset — the trajectory is the interesting pattern the user
  // wants to keep seeing after the disk has stopped. But Reset teleports the disk to the center, so
  // we break the current segment to avoid drawing a synthetic straight line from the old position to
  // the center on the next frame.
  document.getElementById('resetDisk')?.addEventListener('click', pauseTrail);
}

export function tickTrail(){
  if(!initialized) init();
  if(!currentSegment){
    currentSegment = { color: nextSegmentColor, points: [] };
    trail.push(currentSegment);
  }
  currentSegment.points.push({ x: disk.x, y: disk.y });
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

// Set the color used for subsequently recorded segments and close the current
// segment so the new color takes effect on the very next tick.
export function setTrailColor(color){
  nextSegmentColor = color;
  currentSegment = null;
}

// Restore the default trail color (used by the throwaway "reverse" experiment
// when Reset is pressed).
export function resetTrailColor(){
  nextSegmentColor = TRAIL_COLOR;
  currentSegment = null;
}
