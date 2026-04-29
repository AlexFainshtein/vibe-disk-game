// Engine-only shared state. Owns the canvas + ctx + render/input extension points
// shared by every game variant. Variant-specific entities (disk, bar, anchor, bricks,
// mallet, etc.) live in playfield.js and per-variant feature modules and self-register
// onto the hook arrays here.

export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');

function resizeCanvas(){
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas, {passive:true});

export const screen = {
  current: document.body.dataset.player ?? 'alex',
  backgrounds: {
    alex:   { top: '#071018', bottom: '#071018' },
    eugene: { top: '#180710', bottom: '#1a0714' },
    zen1:   { top: '#071018', bottom: '#071018' }
  }
};

export const params = {
  // friction is a fraction in [0,1]. It represents the proportional
  // deceleration factor applied per second (higher = stronger braking).
  friction: 0,
  frameMultiplier: 1,
  bounce: 1
};

// render extension points: feature modules push (ctx) => void callbacks here.
// render.js calls them after the bar and before the disk so extras sit in the playfield, behind the disk.
export const renderExtras = [];

// input extension points: feature modules can register handlers for touches on empty space
// (i.e. neither the bar nor the disk). emptyDown returns true to capture the pointer for subsequent move/up.
// barDown: if set, called when a bar-area touch begins. Return true to take over the drag
// (input.js skips its normal bar drag); return false/undefined to let normal bar drag proceed.
export const inputHooks = {
  emptyDown: null, // (x, y) => boolean
  emptyMove: null, // (x, y) => void
  emptyUp:   null, // () => void
  barDown:   null  // (x, y) => boolean — intercept bar-area pointerdown
};
