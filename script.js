const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W=0,H=0;
function resize(){
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize, {passive:true});
resize();

const params = {
  // friction is a fraction in [0,1]. It represents the proportional
  // deceleration factor applied per second (higher = stronger braking).
  friction: 0.02,
  diskRadius: 36
};

const disk = {
  x: W/2,
  y: H/2,
  r: params.diskRadius,
  vx: 220, // px/sec
  vy: -160,
  color: '#ffb86b'
};

let lastTime = performance.now();
let dragging = false;
let mouseBuf = []; // {x,y,t}

function update(dt){
  if(!dragging){
    const friction = params.friction; // 0..1 fractional braking
    // frameMultiplier scales the per-second friction; use 1 for direct effect
    const frameMultiplier = 1;

    // compute current speed and apply proportional deceleration
    const speed = Math.hypot(disk.vx, disk.vy);
    if(speed > 1e-6 && friction > 0){
      const decel = speed * friction * dt * frameMultiplier;
      const rawNewSpeed = speed - decel;
      let newSpeed;
      // if the sign would change (overshoot past zero), keep original speed
      if(Math.sign(rawNewSpeed) !== Math.sign(speed)){
        newSpeed = speed;
      } else {
        newSpeed = rawNewSpeed;
      }
      const scale = newSpeed / speed;
      disk.vx *= scale;
      disk.vy *= scale;
    }

    disk.x += disk.vx * dt;
    disk.y += disk.vy * dt;

    // wall collisions
    if(disk.x - disk.r < 0){ disk.x = disk.r; disk.vx *= -0.9 }
    if(disk.x + disk.r > W){ disk.x = W - disk.r; disk.vx *= -0.9 }
    if(disk.y - disk.r < 0){ disk.y = disk.r; disk.vy *= -0.9 }
    if(disk.y + disk.r > H){ disk.y = H - disk.r; disk.vy *= -0.9 }
  }
}

function draw(){
  ctx.clearRect(0,0,W,H);
  // subtle background
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#071018'); g.addColorStop(1,'#07141a');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  // disk shadow
  ctx.beginPath();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.ellipse(disk.x+6,disk.y+8,disk.r*0.95,disk.r*0.5,0,0,Math.PI*2);
  ctx.fill();

  // disk
  ctx.beginPath();
  ctx.fillStyle = disk.color;
  ctx.arc(disk.x,disk.y,disk.r,0,Math.PI*2);
  ctx.fill();

  // highlight
  ctx.beginPath();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.ellipse(disk.x - disk.r*0.25, disk.y - disk.r*0.35, disk.r*0.45, disk.r*0.25, -0.5, 0, Math.PI*2);
  ctx.fill();
}

function loop(t){
  const dt = Math.min(0.033, (t - lastTime)/1000);
  lastTime = t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function eventPos(e){
  if(e.touches && e.touches.length) e = e.touches[0];
  return {x: e.clientX, y: e.clientY, t: performance.now()};
}

function distance(a,b){
  const dx = a.x - b.x; const dy = a.y - b.y; return Math.hypot(dx,dy);
}

canvas.addEventListener('pointerdown', (ev)=>{
  const p = eventPos(ev);
  if(distance(p, disk) <= disk.r){
    dragging = true;
    disk.vx = 0; disk.vy = 0;
    mouseBuf = [p];
    canvas.setPointerCapture(ev.pointerId);
  }
});

canvas.addEventListener('pointermove', (ev)=>{
  if(!dragging) return;
  const p = eventPos(ev);
  disk.x = p.x; disk.y = p.y;
  mouseBuf.push(p);
  if(mouseBuf.length > 6) mouseBuf.shift();
});

canvas.addEventListener('pointerup', (ev)=>{
  if(!dragging) return;
  dragging = false;
  const now = performance.now();
  // compute velocity from last samples
  if(mouseBuf.length >= 2){
    const a = mouseBuf[mouseBuf.length-2];
    const b = mouseBuf[mouseBuf.length-1];
    const dt = Math.max(1e-3, (b.t - a.t)/1000);
    disk.vx = (b.x - a.x)/dt;
    disk.vy = (b.y - a.y)/dt;
    // clamp to sensible range
    const max = 1600;
    const speed = Math.hypot(disk.vx, disk.vy);
    if(speed > max){ disk.vx *= max/speed; disk.vy *= max/speed; }
  }
  mouseBuf = [];
  try{ canvas.releasePointerCapture(ev.pointerId); }catch(e){}
});

// click without dragging: small tap should nudge
canvas.addEventListener('click', (e)=>{
  // no-op: handled by pointer events
});

// initialize disk center if resized
window.addEventListener('load', ()=>{
  disk.x = W/2; disk.y = H/2;
});

// Control panel bindings + persistence
function saveSettings(){
  const s = { friction: params.friction, diskRadius: params.diskRadius };
  try{ localStorage.setItem('vibe-settings', JSON.stringify(s)); }catch(e){}
}

function loadSettings(){
  try{
    const raw = localStorage.getItem('vibe-settings');
    if(!raw) return;
    const s = JSON.parse(raw);
    if(typeof s.friction === 'number') params.friction = s.friction;
    if(typeof s.diskRadius === 'number') params.diskRadius = s.diskRadius;
  }catch(e){}
}

function initControls(){
  loadSettings();
  const rSlider = document.getElementById('diskRadius');
  const rVal = document.getElementById('diskRadiusVal');
  const fSlider = document.getElementById('friction');
  const fVal = document.getElementById('frictionVal');
  const reset = document.getElementById('resetDefaults');

  // apply loaded
  rSlider.value = params.diskRadius;
  fSlider.value = params.friction;
  rVal.textContent = params.diskRadius;
  fVal.textContent = String(params.friction);
  disk.r = params.diskRadius;

  rSlider.addEventListener('input', (e)=>{
    params.diskRadius = Number(e.target.value);
    rVal.textContent = params.diskRadius;
    disk.r = params.diskRadius;
    saveSettings();
  });
  fSlider.addEventListener('input', (e)=>{
    params.friction = Number(e.target.value);
    fVal.textContent = params.friction.toFixed(3);
    saveSettings();
  });

  reset.addEventListener('click', ()=>{
    params.friction = 0.98; params.diskRadius = 36;
    rSlider.value = params.diskRadius; fSlider.value = params.friction;
    rVal.textContent = params.diskRadius; fVal.textContent = params.friction;
    disk.r = params.diskRadius; saveSettings();
  });
}

initControls();
