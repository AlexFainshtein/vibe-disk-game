// Tracks whether the user is left- or right-handed. Starts left-handed (button
// at bottom-left reads "L.HAND"). Clicking it switches to right-handed (button
// moves to bottom-right and reads "R.HAND"), and vice versa.
//
// Other modules import `isLeftHanded` to adjust UI placement accordingly.

export let isLeftHanded = true;

const btn = document.getElementById('handBtn');

btn.addEventListener('pointerdown', e => {
  e.stopPropagation();
  isLeftHanded = !isLeftHanded;
  if (isLeftHanded) {
    btn.textContent = 'L.HAND';
    btn.className = 'hand-btn hand-left';
  } else {
    btn.textContent = 'R.HAND';
    btn.className = 'hand-btn hand-right';
  }
});
