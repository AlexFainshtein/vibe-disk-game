import { canvas, ctx, screen, renderExtras, renderOverlays } from './state.js';
import { disk, bar } from './playfield.js';

// Draws the playfield primitives shared by every variant: background, feature
// extras (trail, bumper, bricks, etc.), bar, and the disk. The disk renders
// as a flat fill by default; setting `disk.highlight` opts into the 3D "ball"
// look — drop shadow + radial gradient + specular ellipse, all three gated on
// disk.highlight so they revive together. `disk.glass` triggers the
// soap-bubble look used when Eugene's disk hits the bar.
//
// Variant-specific visuals are pushed into renderExtras by their owning
// modules and drawn *underneath* the bar so the bar reads as the topmost
// playfield-furniture object (matching its interactive priority — the user
// can grab the bar even when a bumper is visually beneath it). Visuals that
// must sit *on top of* the disk (e.g. Alex's spring line + endpoint dots) go
// into renderOverlays instead, drawn last.

export function draw(){
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const bg = screen.backgrounds[screen.current];
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0, bg.top); g.addColorStop(1, bg.bottom);
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  // feature-supplied extras (bricks, mallet, bubble pop, spring line, trail, bumper, ...)
  for(const fn of renderExtras) fn(ctx);

  if(!bar.hidden){
    const bx1 = bar.x1 ?? 0;
    const bx2 = bar.x2 ?? W;
    const bw  = bx2 - bx1;
    ctx.fillStyle = bar.color;
    ctx.fillRect(bx1, bar.y, bw, bar.height);
    const handleW = Math.min(bw * 0.15, 60);
    const handleX = bx1 + bw / 2 - handleW / 2;
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
  }
  // Always call overlay so hidden variants can draw their own bar entirely.
  bar.overlay?.(ctx);

  // shadow — only in 3D ball mode (gated on disk.highlight, same flag that
  // turns on the radial gradient + specular ellipse below)
  if(disk.highlight){
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.ellipse(disk.x+6,disk.y+8,disk.r*0.95,disk.r*0.5,0,0,Math.PI*2);
    ctx.fill();
  }

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
  } else if(disk.highlight){
    // Shaded "ball" look: radial gradient from disk.highlight (small bright
    // spot offset toward upper-left, simulating a light source above-left)
    // to disk.color (the edge / shaded side).
    const grad = ctx.createRadialGradient(
      disk.x - disk.r*0.4, disk.y - disk.r*0.4, disk.r*0.05,
      disk.x,              disk.y,              disk.r
    );
    grad.addColorStop(0, disk.highlight);
    grad.addColorStop(1, disk.color);
    ctx.fillStyle = grad;
    ctx.fill();
  } else {
    ctx.fillStyle = disk.color;
    ctx.fill();
  }

  // specular highlight ellipse — small white blob in the upper-left, completing
  // the 3D ball illusion. Drawn for the bubble (bright, opaque) and for the
  // 3D ball (faint). A flat disc (no highlight, no glass) skips it.
  if(disk.glass || disk.highlight){
    ctx.beginPath();
    ctx.fillStyle = disk.glass ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.06)';
    ctx.ellipse(disk.x - disk.r*0.25, disk.y - disk.r*0.35, disk.r*0.45, disk.r*0.25, -0.5, 0, Math.PI*2);
    ctx.fill();
  }

  // feature-supplied overlays (Alex's spring line + center marker, ...). Drawn
  // last so they sit on top of the disk.
  for(const fn of renderOverlays) fn(ctx);
}
