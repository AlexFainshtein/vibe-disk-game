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
  friction: 0.02,
  diskRadius: 36,
  frameMultiplier: 1,
  wallBounce: -0.9
};

export const disk = {
  x: canvas.width/2,
  y: canvas.height/2,
  r: params.diskRadius,
  vx: 220, // px/sec
  vy: -160,
  color: '#ffb86b'
};

export const input = {
  dragging: false,
  mouseBuf: [] // {x,y,t}
};
