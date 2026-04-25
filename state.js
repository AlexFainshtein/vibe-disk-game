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
  frameMultiplier: 1,
  bounce: 1
};

// Disk radius is a fraction of the shorter canvas dimension so it stays right-sized across phones / orientations.
export const DISK_RADIUS_FRACTION = 1/6;

export const disk = {
  x: canvas.width/2,
  y: canvas.height/2,
  r: Math.min(canvas.width, canvas.height) * DISK_RADIUS_FRACTION,
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
  disk.r = Math.min(canvas.width, canvas.height) * DISK_RADIUS_FRACTION;
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

// render extension points: feature modules push (ctx) => void callbacks here.
// render.js calls them after the bar and before the disk so extras sit in the playfield, behind the disk.
export const renderExtras = [];

// input extension points: feature modules can register handlers for touches on empty space
// (i.e. neither the bar nor the disk). emptyDown returns true to capture the pointer for subsequent move/up.
export const inputHooks = {
  emptyDown: null, // (x, y) => boolean
  emptyMove: null, // (x, y) => void
  emptyUp:   null  // () => void
};
