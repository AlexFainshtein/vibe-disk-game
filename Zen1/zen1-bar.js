import { canvas, inputHooks } from '../state.js';
import { bar, disk } from '../playfield.js';

let _barDownSound = null;
export function setBarDownSound(fn){ _barDownSound = fn; }

// Zen1 bar: tilted trapezoid with independently draggable left/right edges.
// bar.y1 = Y of left edge top, bar.y2 = Y of right edge top.
// bar.y = min(y1, y2) so input.js bounding-box check covers the trapezoid.
// bar.hidden = true so render.js skips its flat-rect draw; bar.overlay draws everything.

bar.hidden = true;

const BUMPER_R_FRACTION = 1/6;  // must match BUMPER_RADIUS_FRACTION in zen1-bumper.js
function initialBarY(){
  const r = Math.min(canvas.width, canvas.height) * BUMPER_R_FRACTION;
  return canvas.height - 2 * r;
}

bar.y1 = initialBarY();
bar.y2 = initialBarY();
bar.y  = bar.y1;

// Called by zen1-physics on resize (playfield.js resize fires first and updates bar.height).
function resetToFlat(){
  bar.y1 = initialBarY();
  bar.y2 = initialBarY();
  bar.y  = bar.y1;
  bar.prevY1 = null;
  bar.prevY2 = null;
}
window.addEventListener('resize', resetToFlat, { passive: true });
document.getElementById('resetDisk')?.addEventListener('click', resetToFlat);

bar.floorY = (x) => bar.y1 + (bar.y2 - bar.y1) * (x / canvas.width);

bar.prevY1 = bar.y1;
bar.prevY2 = bar.y2;

const HANDLE_W   = 48;  // px width of each edge handle hit zone
const HANDLE_VIS = 10;  // px width of the visible indicator strip
// Snap to the nearest angle of the form 360/N (N integer >= 4), plus 0 (horizontal).
// N_exact = 2PI/|theta|; the nearest valid snap is at floor or ceil of N_exact.
// No precomputed list, no artificial limit — covers all N up to infinity (horizontal).
const MIN_SNAP_ANGLE = 1 * Math.PI / 180; // below 1°, snap to horizontal

function snapAngle(theta){
  const sign = theta >= 0 ? 1 : -1;
  const abs  = Math.abs(theta);
  if(abs < MIN_SNAP_ANGLE) return 0;
  const nExact = 2 * Math.PI / abs;
  const nLo    = Math.max(4, Math.floor(nExact));
  const nHi    = Math.max(4, Math.ceil(nExact));
  const angLo  = 2 * Math.PI / nLo;
  const angHi  = 2 * Math.PI / nHi;
  return sign * (Math.abs(abs - angLo) <= Math.abs(abs - angHi) ? angLo : angHi);
}

bar.overlay = (c) => {
  const y1 = bar.y1, y2 = bar.y2, h = bar.height, W = canvas.width;

  // Trapezoid body
  c.beginPath();
  c.moveTo(0, y1);
  c.lineTo(W, y2);
  c.lineTo(W, y2 + h);
  c.lineTo(0, y1 + h);
  c.closePath();
  c.fillStyle = bar.color;
  c.fill();

  // Grip stripes — parallel to bar surface.
  // barY(x) gives the y of the bar's top edge at a given x.
  function barY(x){ return y1 + (y2 - y1) * x / W; }

  // Draw two stripes parallel to bar, centered at cx, spanning width sw.
  function drawGrip(cx, sw){
    const x0 = cx - sw / 2, x1 = cx + sw / 2;
    c.beginPath();
    c.moveTo(x0, barY(x0) + h * 0.35); c.lineTo(x1, barY(x1) + h * 0.35);
    c.moveTo(x0, barY(x0) + h * 0.60); c.lineTo(x1, barY(x1) + h * 0.60);
    c.stroke();
  }

  c.strokeStyle = 'rgba(255,255,255,0.55)';
  c.lineWidth = 2;

  const mw = Math.min(W * 0.15, 60);  // middle grip width
  const sw = mw * 0.45;               // side grip width (shorter)
  drawGrip(W / 2, mw);                // middle
  drawGrip(HANDLE_W / 2, sw);         // left edge
  drawGrip(W - HANDLE_W / 2, sw);     // right edge
};

// --- Input ---

let dragMode = null; // 'left' | 'right' | 'middle'
let dragStartY = 0, dragStartY1 = 0, dragStartY2 = 0;

const MIN_BAR_Y = () => disk.r * 2;
const MAX_BAR_Y = () => canvas.height - bar.height;

function clampEdge(y){ return Math.max(MIN_BAR_Y(), Math.min(MAX_BAR_Y(), y)); }

function trapTopAt(x){ return bar.y1 + (bar.y2 - bar.y1) * (x / canvas.width); }

inputHooks.barDown = (x, y) => {
  const topAtX = trapTopAt(x);
  // Reject touches outside the actual trapezoid shape.
  if(y < topAtX || y > topAtX + bar.height) return false;

  dragStartY = y;
  dragStartY1 = bar.y1;
  dragStartY2 = bar.y2;

  if(x < HANDLE_W){
    dragMode = 'left';
  } else if(x > canvas.width - HANDLE_W){
    dragMode = 'right';
  } else {
    dragMode = 'middle';
  }
  if(_barDownSound) _barDownSound();
  return true;
};

// Chain into previously registered emptyMove/emptyUp (zen1-bumper registers lazily;
// its init() will chain onto these when it first runs).
const prevEmptyMove = inputHooks.emptyMove;
const prevEmptyUp   = inputHooks.emptyUp;

inputHooks.emptyMove = (x, y) => {
  if(!dragMode){ if(prevEmptyMove) prevEmptyMove(x, y); return; }
  const dy = y - dragStartY;
  if(dragMode === 'left'){
    const raw       = clampEdge(dragStartY1 + dy);
    const theta     = Math.atan2(bar.y2 - raw, canvas.width);
    bar.y1          = clampEdge(bar.y2 - canvas.width * Math.tan(snapAngle(theta)));
  } else if(dragMode === 'right'){
    const raw       = clampEdge(dragStartY2 + dy);
    const theta     = Math.atan2(raw - bar.y1, canvas.width);
    bar.y2          = clampEdge(bar.y1 + canvas.width * Math.tan(snapAngle(theta)));
  } else {
    // Middle: move both edges together, preserving tilt. No clamping.
    bar.y1 = dragStartY1 + dy;
    bar.y2 = dragStartY2 + dy;
  }
  bar.y = Math.min(bar.y1, bar.y2); // keep bounding box in sync for input.js
};

inputHooks.emptyUp = () => {
  if(dragMode){ dragMode = null; }
  else if(prevEmptyUp) prevEmptyUp();
};
