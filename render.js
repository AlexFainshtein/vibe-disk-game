import { canvas, ctx, screen, renderExtras } from './state.js';
import { disk, bar, clickMarker } from './playfield.js';

// Draws the playfield primitives shared by every variant: background, feature
// extras (trail, bumper, bricks, etc.), bar, disk, shadow, highlight, debug
// click ring. Variant-specific visuals are pushed into renderExtras by their
// owning modules and drawn *underneath* the bar so the bar reads as the
// topmost playfield-furniture object (matching its interactive priority — the
// user can grab the bar even when a bumper is visually beneath it).

export function draw(){
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const bg = screen.backgrounds[screen.current];
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0, bg.top); g.addColorStop(1, bg.bottom);
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  // feature-supplied extras (bricks, mallet, bubble pop, spring line, trail, bumper, ...)
  for(const fn of renderExtras) fn(ctx);

  // bar — drawn after renderExtras so it sits on top of the bumper / trail / etc.
  ctx.fillStyle = bar.color;
  ctx.fillRect(0, bar.y, W, bar.height);

  // bar drag-handle hint: two short horizontal dashes centered on the bar.
  // Visual affordance that the bar is grabbable.
  const handleW = Math.min(W * 0.15, 60);
  const handleX = (W - handleW) / 2;
  const handleY1 = bar.y + bar.height * 0.4;
  const handleY2 = bar.y + bar.height * 0.6;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(handleX, handleY1);
  ctx.lineTo(handleX + handleW, handleY1);
  ctx.moveTo(handleX, handleY2);
  ctx.lineTo(handleX + handleW, handleY2);
  ctx.stroke();

  // shadow
  ctx.beginPath();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.ellipse(disk.x+6,disk.y+8,disk.r*0.95,disk.r*0.5,0,0,Math.PI*2);
  ctx.fill();

  // disk
  ctx.beginPath();
  ctx.arc(disk.x, disk.y, disk.r, 0, Math.PI*2);
  if(disk.glass){
    // Soap bubble: near-invisible body with iridescent rim
    ctx.fillStyle = 'rgba(210,235,255,0.07)';
    ctx.fill();
    // iridescent rim — linear gradient approximating rainbow sheen
    const rimGrad = ctx.createLinearGradient(
      disk.x - disk.r, disk.y - disk.r,
      disk.x + disk.r, disk.y + disk.r);
    rimGrad.addColorStop(0,    'rgba(255,120,220,0.85)');
    rimGrad.addColorStop(0.33, 'rgba(100,210,255,0.85)');
    rimGrad.addColorStop(0.66, 'rgba(180,255,120,0.85)');
    rimGrad.addColorStop(1,    'rgba(255,120,220,0.85)');
    ctx.strokeStyle = rimGrad;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else {
    ctx.fillStyle = disk.color;
    ctx.fill();
  }

  // highlight
  ctx.beginPath();
  ctx.fillStyle = disk.glass ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.14)';
  ctx.ellipse(disk.x - disk.r*0.25, disk.y - disk.r*0.35, disk.r*0.45, disk.r*0.25, -0.5, 0, Math.PI*2);
  ctx.fill();

  // debug: disk boundary circle on hit
  if(clickMarker.active && clickMarker.hit){
    ctx.beginPath();
    ctx.arc(disk.x, disk.y, disk.r, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(0,255,0,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
