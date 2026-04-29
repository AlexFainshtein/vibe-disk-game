import { canvas, inputHooks } from '../state.js';
import { bar, disk } from '../playfield.js';
import { playGrab, playRelease } from '../sound.js';

// Zen1 bar: tilted trapezoid with independently draggable left/right edges.
// bar.y1 = Y of left edge top, bar.y2 = Y of right edge top.
// bar.y = min(y1, y2) so input.js bounding-box check covers the trapezoid.
// bar.hidden = true so render.js skips its flat-rect draw; bar.overlay draws everything.

bar.hidden = true;

function initialBarY(){ return canvas.height * 0.95 - bar.height; }

bar.y1 = initialBarY();
bar.y2 = initialBarY();
bar.y  = bar.y1;

// Called by zen1-physics on resize (playfield.js resize fires first and updates bar.height).
function resetToFlat(){
  bar.y1 = initialBarY();
  bar.y2 = initialBarY();
  bar.y  = bar.y1;
  bar.prevY1 = bar.y1;
  bar.prevY2 = bar.y2;
}
window.addEventListener('resize', resetToFlat, { passive: true });
document.getElementById('resetDisk')?.addEventListener('click', resetToFlat);

bar.prevY1 = bar.y1;
bar.prevY2 = bar.y2;

const HANDLE_W   = 48;  // px width of each edge handle hit zone
const HANDLE_VIS = 10;  // px width of the visible indicator strip

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

  // Center grip lines (horizontal, at midpoint of bar)
  const midTop = (y1 + y2) / 2;
  const hw = Math.min(W * 0.15, 60);
  const hx = W / 2 - hw / 2;
  c.strokeStyle = 'rgba(255,255,255,0.45)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(hx, midTop + h * 0.4); c.lineTo(hx + hw, midTop + h * 0.4);
  c.moveTo(hx, midTop + h * 0.6); c.lineTo(hx + hw, midTop + h * 0.6);
  c.stroke();

  // Left edge handle indicator
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.fillRect(0, y1, HANDLE_VIS, h);

  // Right edge handle indicator
  c.fillRect(W - HANDLE_VIS, y2, HANDLE_VIS, h);
};

// --- Input ---

let dragMode = null; // 'left' | 'right' | 'middle'
let dragStartY = 0, dragStartY1 = 0, dragStartY2 = 0;

const MIN_BAR_Y = () => disk.r * 3;
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
  playGrab();
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
    bar.y1 = clampEdge(dragStartY1 + dy);
  } else if(dragMode === 'right'){
    bar.y2 = clampEdge(dragStartY2 + dy);
  } else {
    // Middle: move both edges together, preserving tilt.
    let ny1 = dragStartY1 + dy, ny2 = dragStartY2 + dy;
    const lo = MIN_BAR_Y(), hi = MAX_BAR_Y();
    const overTop = lo - Math.min(ny1, ny2);
    const overBot = Math.max(ny1, ny2) - hi;
    if(overTop > 0){ ny1 += overTop; ny2 += overTop; }
    if(overBot > 0){ ny1 -= overBot; ny2 -= overBot; }
    bar.y1 = ny1; bar.y2 = ny2;
  }
  bar.y = Math.min(bar.y1, bar.y2); // keep bounding box in sync for input.js
};

inputHooks.emptyUp = () => {
  if(dragMode){ dragMode = null; playRelease(); }
  else if(prevEmptyUp) prevEmptyUp();
};
