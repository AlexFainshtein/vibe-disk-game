export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');

function resize(){
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize, {passive:true});
resize();

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

export const bar = {
  y: canvas.height * 0.85,
  prevY: canvas.height * 0.85,
  vy: 0,
  height: 16,
  color: '#88aacc',
  dragging: false
};

export const input = {
  dragging: false,
  mouseBuf: [] // {x,y,t}
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

// line from click point to disk center
export const clickLine = {
  active: false,
  clickX: 0,
  clickY: 0
};
