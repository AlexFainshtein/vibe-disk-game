// Tracks whether the user is left- or right-handed. Starts right-handed
// (button at bottom-left reads "L.HAND" — click to switch to left-handed).
// When left-handed, button moves to bottom-right and reads "R.HAND".
//
// Other modules import `isLeftHanded` to adjust UI placement accordingly.

export let isLeftHanded = false;

const btn = document.getElementById('handBtn');

btn.addEventListener('pointerdown', e => {
  e.stopPropagation();
  isLeftHanded = !isLeftHanded;
  if (isLeftHanded) {
    btn.textContent = 'R.HAND';
    btn.className = 'hand-btn hand-right';
  } else {
    btn.textContent = 'L.HAND';
    btn.className = 'hand-btn hand-left';
  }
});
