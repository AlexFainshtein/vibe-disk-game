import { canvas, ctx, disk, bar, clickMarker, anchor, screen, renderExtras, bricks, mallet, bubblePop } from './state.js';

export function draw(){
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const bg = screen.backgrounds[screen.current];
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0, bg.top); g.addColorStop(1, bg.bottom);
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  // bricks — no screen check needed: initBricks() leaves the array empty on Alex's screen.
  for(const b of bricks){
    if(!b.alive) continue;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // bar
  ctx.fillStyle = bar.color;
  ctx.fillRect(0, bar.y, W, bar.height);

  // feature-supplied extras (e.g. targets), behind the disk
  for(const fn of renderExtras) fn(ctx);

  // hollow shell mallet (Eugene's variant only)
  if(mallet.active && screen.current === 'eugene'){
    const shellR = mallet.r;
    const strokeW = Math.max(4, shellR * 0.12);
    ctx.beginPath();
    ctx.arc(mallet.x, mallet.y, shellR, 0, Math.PI * 2);
    ctx.strokeStyle = mallet.mode === 'inside'
      ? 'rgba(255,180,80,0.85)'   // warm amber when ball is trapped inside
      : 'rgba(160,220,255,0.85)'; // cool blue when ball is outside
    ctx.lineWidth = strokeW;
    ctx.stroke();
  }

  // bubble pop animation
  if(bubblePop.active){
    const p = bubblePop.t / bubblePop.duration; // 0→1
    const alpha = 1 - p;
    const r = disk.r * (1 + p * 1.8);
    // expanding iridescent ring
    ctx.beginPath();
    ctx.arc(bubblePop.x, bubblePop.y, r, 0, Math.PI * 2);
    const rimGrad = ctx.createLinearGradient(
      bubblePop.x - r, bubblePop.y - r,
      bubblePop.x + r, bubblePop.y + r);
    rimGrad.addColorStop(0,    `rgba(255,120,220,${alpha * 0.9})`);
    rimGrad.addColorStop(0.33, `rgba(100,210,255,${alpha * 0.9})`);
    rimGrad.addColorStop(0.66, `rgba(180,255,120,${alpha * 0.9})`);
    rimGrad.addColorStop(1,    `rgba(255,120,220,${alpha * 0.9})`);
    ctx.strokeStyle = rimGrad;
    ctx.lineWidth = Math.max(0.5, 3 * (1 - p));
    ctx.stroke();
    // droplets flying outward
    const maxDist = disk.r * 2.2 * p;
    for(const part of bubblePop.particles){
      const px = bubblePop.x + part.ax * maxDist;
      const py = bubblePop.y + part.ay * maxDist;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.5, 3.5 * (1 - p)), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180,230,255,${alpha * 0.85})`;
      ctx.fill();
    }
  }

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

  // spring line from anchor to disk center — Eugene's variant only;
  // Alex's variant uses the spring physics invisibly. Re-enable per-player by adding to this check.
  if(anchor.active && screen.current === 'eugene'){
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.lineTo(disk.x, disk.y);
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.stroke();
    // dot at anchor point
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, 5, 0, Math.PI*2);
    ctx.fillStyle = '#00ff00';
    ctx.fill();
  }
}
