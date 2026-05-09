import { canvas, renderExtras } from '../state.js';
import { disk } from '../playfield.js';

// Wall of breakable bricks at the top, plus the bubble-pop animation that
// fires when the disk's "glass" mode pops against a brick. bubblePop is
// colocated here because its lifecycle is triggered by brick collision.
//
// Self-registers a render hook and a Reset-button listener at module load.
// Brick collision logic itself lives in alex1-physics.js (it's interleaved
// with the substep integration there).

export const bricks = [];

export function initBricks(){
  bricks.length = 0;
  const cols = 7, rows = 4;
  const gap = 5;
  const brickW = (canvas.width - gap * (cols + 1)) / cols;
  const brickH = 20;
  const startY = 120;
  const rowColors = ['#7a1a3a','#6b1a45','#5c1a50','#4d1a5b'];
  for(let r = 0; r < rows; r++){
    for(let c = 2; c < cols; c++){
      bricks.push({
        x: gap + c * (brickW + gap),
        y: startY + r * (brickH + gap),
        w: brickW,
        h: brickH,
        alive: true,
        color: rowColors[r]
      });
    }
  }
}

// bubble pop animation state — spawned when a glass disk hits a brick
export const bubblePop = {
  active: false,
  x: 0, y: 0,
  t: 0,
  duration: 0.45,
  particles: [] // [{ax, ay}] unit-ish direction vectors
};

function drawBricks(c){
  for(const b of bricks){
    if(!b.alive) continue;
    c.fillStyle = b.color;
    c.beginPath();
    c.roundRect(b.x, b.y, b.w, b.h, 4);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth = 1;
    c.stroke();
  }
}

function drawBubblePop(c){
  if(!bubblePop.active) return;
  const p = bubblePop.t / bubblePop.duration; // 0→1
  const alpha = 1 - p;
  const r = disk.r * (1 + p * 1.8);
  // expanding iridescent ring
  c.beginPath();
  c.arc(bubblePop.x, bubblePop.y, r, 0, Math.PI * 2);
  const rimGrad = c.createLinearGradient(
    bubblePop.x - r, bubblePop.y - r,
    bubblePop.x + r, bubblePop.y + r);
  rimGrad.addColorStop(0,    `rgba(255,120,220,${alpha * 0.9})`);
  rimGrad.addColorStop(0.33, `rgba(100,210,255,${alpha * 0.9})`);
  rimGrad.addColorStop(0.66, `rgba(180,255,120,${alpha * 0.9})`);
  rimGrad.addColorStop(1,    `rgba(255,120,220,${alpha * 0.9})`);
  c.strokeStyle = rimGrad;
  c.lineWidth = Math.max(0.5, 3 * (1 - p));
  c.stroke();
  // droplets flying outward
  const maxDist = disk.r * 2.2 * p;
  for(const part of bubblePop.particles){
    const px = bubblePop.x + part.ax * maxDist;
    const py = bubblePop.y + part.ay * maxDist;
    c.beginPath();
    c.arc(px, py, Math.max(0.5, 3.5 * (1 - p)), 0, Math.PI * 2);
    c.fillStyle = `rgba(180,230,255,${alpha * 0.85})`;
    c.fill();
  }
}

renderExtras.push(drawBricks);
renderExtras.push(drawBubblePop);
initBricks();
document.getElementById('resetDisk')?.addEventListener('click', initBricks);
