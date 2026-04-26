import { disk } from './playfield.js';

// Pause/Resume button (Alex variant only). Pause saves the disk's current velocity and zeros it,
// so the disk freezes mid-flight. Resume restores the saved velocity. If the user grabs the disk
// while paused, alex-physics calls clearPause() — the saved velocity is discarded because the user
// is taking over.

let paused = false;
let savedVx = 0;
let savedVy = 0;

const buttonRef = document.getElementById('pauseBtn');

function setLabel(){
  if(buttonRef) buttonRef.textContent = paused ? '▶ Resume' : '⏸ Pause';
}

function togglePause(){
  if(!paused){
    savedVx = disk.vx;
    savedVy = disk.vy;
    disk.vx = 0;
    disk.vy = 0;
    paused = true;
  } else {
    disk.vx = savedVx;
    disk.vy = savedVy;
    paused = false;
  }
  setLabel();
}

if(buttonRef){
  buttonRef.addEventListener('pointerdown', (e) => e.stopPropagation());
  buttonRef.addEventListener('click', togglePause);
}

export function clearPause(){
  if(!paused) return;
  paused = false;
  setLabel();
}

export function isPaused(){
  return paused;
}
