import { renderOverlays } from './state.js';
import { disk } from './playfield.js';

const TRAIL_COLOR = 'rgba(255, 255, 255, 0.28)';
const TRAIL_WIDTH = 1.5;

// trail is an array of segments; each segment is { color, composite, width, points: [{x,y}, ...] }.
// Segments let us pause recording (e.g. while the user is holding the disk) and
// resume later without drawing a straight line between the pre-pause and post-resume points.
// Per-segment color + composite + width let the throwaway "reverse" experiment
// draw reverse strokes in the background color, slightly thicker than forward
// so antialiased edges fully cover and the forward trail erases cleanly.
const trail = [];
let currentSegment = null;
let nextSegmentColor = TRAIL_COLOR;
let nextSegmentComposite = 'source-over';
let nextSegmentWidth = TRAIL_WIDTH;
let initialized = false;

function drawTrail(c){
  for(const segment of trail){
    if(segment.points.length < 2) continue;
    c.strokeStyle = segment.color;
    c.globalCompositeOperation = segment.composite || 'source-over';
    c.lineWidth = segment.width || TRAIL_WIDTH;
    c.beginPath();
    c.moveTo(segment.points[0].x, segment.points[0].y);
    for(let i = 1; i < segment.points.length; i++){
      c.lineTo(segment.points[i].x, segment.points[i].y);
    }
    c.stroke();
  }
  c.globalCompositeOperation = 'source-over'; // restore default for subsequent draw calls in this frame
}

function init(){
  if(initialized) return;
  initialized = true;
  renderOverlays.push(drawTrail);
  // Reset wipes the trail — "Reset" reads as "wipe everything and start fresh",
  // and a preserved trail with the disk teleported back to center feels weird
  // (trajectory of a thing that's no longer there). Pause is the "preserve
  // pattern" affordance: it freezes the disk in place without erasing.
  document.getElementById('resetDisk')?.addEventListener('click', resetTrail);
}

export function tickTrail(){
  if(!initialized) init();
  if(!currentSegment){
    currentSegment = { color: nextSegmentColor, composite: nextSegmentComposite, width: nextSegmentWidth, points: [] };
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

// Set the color (and optional composite mode + line width) used for
// subsequently recorded segments. Closes the current segment so the new style
// takes effect on the very next tick. Used by the throwaway "reverse"
// experiment.
export function setTrailColor(color, composite = 'source-over', width = TRAIL_WIDTH){
  nextSegmentColor = color;
  nextSegmentComposite = composite;
  nextSegmentWidth = width;
  currentSegment = null;
}

// Restore the default trail color, composite mode, and line width (used by
// the throwaway "reverse" experiment when Reset is pressed or the reverse
// is toggled back to forward).
export function resetTrailColor(){
  nextSegmentColor = TRAIL_COLOR;
  nextSegmentComposite = 'source-over';
  nextSegmentWidth = TRAIL_WIDTH;
  currentSegment = null;
}

// Whether the trail has any drawn content (any segment with at least one
// recorded point). Used by the Reverse-button enable/disable check — the
// reverse experiment's visual effect requires an existing trail to act on.
export function trailHasContent(){
  for(const segment of trail){
    if(segment.points.length > 0) return true;
  }
  return false;
}
