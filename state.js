export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');

function resizeCanvas(){
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();

export const screen = {
  current: document.body.dataset.player ?? 'alex',
  backgrounds: {
    alex:   { top: '#071018', bottom: '#07141a' },
    eugene: { top: '#180710', bottom: '#1a0714' }
  }
};

export const params = {
  // friction is a fraction in [0,1]. It represents the proportional
  // deceleration factor applied per second (higher = stronger braking).
  friction: 0,
  diskRadius: 60,
  frameMultiplier: 1,
  bounce: 1
};

export const disk = {
  x: canvas.width/2,
  y: canvas.height/2,
  r: params.diskRadius,
  vx: 0,
  vy: 0,
  color: '#ffb86b'
};

const BAR_HEIGHT = 16;
const initialBarY = document.body.dataset.player === 'eugene'
  ? canvas.height - BAR_HEIGHT
  : canvas.height * 0.85;

export const bar = {
  y: initialBarY,
  prevY: initialBarY,
  vy: 0,
  height: BAR_HEIGHT,
  color: '#88aacc',
  dragging: false
};

window.addEventListener('resize', ()=>{
  resizeCanvas();
  if(document.body.dataset.player === 'eugene'){
    bar.y = canvas.height - bar.height;
    bar.prevY = bar.y;
  }
}, {passive:true});

export const input = {
  dragging: false,
  mouseBuf: [] // {x,y,t}
};

// spring anchor: the point the disk is pulled toward
export const anchor = {
  active: false,
  x: 0,
  y: 0,
  prevX: 0,
  prevY: 0
};

// debug: hit detection state
export const clickMarker = {
  active: false,
  hit: false
};

// recent disk positions for lag-compensated hit detection
const HISTORY_SIZE = 5;
export const diskHistory = [];
export function recordDiskPosition(){
  diskHistory.push({x: disk.x, y: disk.y});
  if(diskHistory.length > HISTORY_SIZE) diskHistory.shift();
}
