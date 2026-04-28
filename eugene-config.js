// All tunable parameters for Eugene's variant in one place.

// --- Disk ---
export const DISK_RADIUS_FRACTION   = 1/40;   // fraction of shorter canvas dimension

// --- Physics ---
export const GRAVITY                = 400;    // px/s² downward acceleration
export const DRAG                   = 0.3;    // speed-proportional damping, fraction/second
export const DRAG_INSIDE_MALLET     = 3.3;    // drag when ball is trapped inside the ring
export const WALL_BOUNCE            = 1;      // restitution for left / right / top walls
export const FLOOR_BOUNCE           = 1.0;    // restitution for bottom edge (> 1 adds energy)
export const MAX_BOUNCE_SPEED       = 1200;   // px/s — normalises knock sound intensity
export const SUBSTEPS               = 4;      // sub-steps per frame for brick collision accuracy

// --- Ring (mallet) ---
export const MALLET_RADIUS_FRACTION = (1/40) * 9 * 0.5;  // fraction of shorter canvas dimension
export const MALLET_CENTER_OFFSET   = 2;      // ring center placed this many radii beyond touch point
export const MALLET_INNER_RESTITUTION = 0.5;  // restitution against inner wall (< 1 = energy loss)

// --- Handedness / thumb geometry ---
export const THUMB_CORNER_Y         = 0.95;   // thumb pivot: this fraction of screen height from top
