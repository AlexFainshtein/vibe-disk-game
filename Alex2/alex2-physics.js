import { canvas, inputHooks, renderExtras } from '../state.js';
import { disk, bar, setDiskRadiusFraction } from '../playfield.js';

// Alex2: chain dynamics via REDUCED COORDINATES.
// Each rope is parameterized by N-1 joint angles θ_k (one per segment).
// Distance constraints are exact by construction — there's nothing to solve.
// The equations of motion come from Lagrangian mechanics:
//   M(θ) · θ̈ + C(θ, θ̇) = Q_anchor
// where:
//   M_{jk}(θ) = L² · cos(θ_j − θ_k) · μ_{jk}
//   C_j(θ,θ̇) = Σ_k L² · μ_{jk} · sin(θ_j − θ_k) · θ̇_k²
//   Q_anchor_j = L · μ_{jj} · (sin θ_j · ẍ_anchor − cos θ_j · ÿ_anchor)
//   μ_{jk}     = Σ_{i ≥ max(j,k)} m_i   (total mass of particles affected by both θ_j and θ_k)
//
// Time stepping: RK4 on the first-order system y' = f(y), y = [θ, θ̇].
// Each RK4 evaluation builds M, C, Q and does a dense Gaussian-elimination
// solve M · θ̈ = Q − C. That's O(N³) per evaluation, ×4 per frame, ×2 ropes.
// For N up to ~200 this is comfortably real-time.
//
// Anchor inputs (mouse drag AND arrow keys) both deliver their effect as
// angular-momentum impulses: each frame we compute the anchor's Δv (from
// the position change for drag, from the key press for keyboard) and apply
//   M · Δθ̇ = L · μ_{jj} · (sin θ_j · Δvx − cos θ_j · Δvy)
// directly to θ̇. The conservative RHS sees ax = ay = 0 — there is no
// integrated-force coupling from anchor acceleration. This eliminates the
// finite-difference acceleration spikes that mouse jitter would otherwise
// produce, and gives one uniform mechanism for all input.
//
// Two-rope comparison view: same anchor input drives two ropes with
// different N drawn one above the other, so we can see N-dependence directly.

bar.hidden = true;
inputHooks.diskGrab = false;
setDiskRadiusFraction(0);

const N1 = 50;
const N2 = 100;
const ROPE_LENGTH_FRACTION = 0.45;

// Total chain mass (excluding anchor). Distributed uniformly across the
// N−1 non-anchor particles. Combined with the Lagrangian formulation,
// dynamics should be approximately N-invariant.
const M_ROPE = 1;

// Visible-motion slowdown. The chain physics advances dt / SLOWDOWN per
// real frame. NOTE: the anchor's drag motion is NOT slowed — only the
// chain's internal physics is. So with SLOWDOWN > 1, drag will look
// inconsistent (chain reacts slowly, anchor moves fast in physics terms).
// Recommended: use SLOWDOWN = 1 with normal drag, OR SLOWDOWN > 1 with only
// keyboard "kicks" (which apply impulses directly and ignore SLOWDOWN
// artifacts).
const SLOWDOWN = 1;

const ANCHOR_MARKER_RADIUS_FRAC = 1 / 60;
const ANCHOR_GRAB_RADIUS_FRAC   = 1 / 30;
const ANCHOR_COLOR = '#555555'; // was 88c0d0

// One arrow-key press changes anchor velocity by this much (px / s). The
// resulting angular-momentum impulse is applied directly to the chain.
const ANCHOR_KEY_VELOCITY_STEP = 50;

// Bending stiffness. Per-joint angular spring constant k_θ = BENDING_EI / L.
// BENDING_EI is the continuum flexural rigidity (N-invariant material
// property). Higher = stiffer, but too high will require smaller dt for
// RK4 stability. Set to 0 to disable bending entirely (chain is a free
// jointed pendulum with no restoring force).
const BENDING_EI = 0;

// --- Damping (non-conservative; added directly to the EOM, not Lagrangian) ---
//
// DAMPING_BEND: strain-rate / stiffness-proportional damping. Force per
// joint = c · (θ̇_{j-1} − 2θ̇_j + θ̇_{j+1}) — the discrete Laplacian of θ̇.
// Pulls each joint's angular velocity toward its neighbors'. Has *zero
// effect* on rigid rotation (all θ̇ equal → Laplacian = 0), so the chain
// can still spin freely; but suppresses high-frequency / alternating-sign
// modes exponentially. Analog of stiffness-proportional Rayleigh damping.
//
// Applied via OPERATOR SPLITTING with backward-Euler (implicit) integration
// of the damping force: after each RK4 step, we solve
//   (M − h·c·D)·θ̇_new = M·θ̇_old        with D = discrete Laplacian
// for the new angular velocity. Unconditionally stable for any c ≥ 0, so
// this can be tuned freely without worrying about integrator blow-up.
const DAMPING_BEND = 10;

// DAMPING_MASS: mass-proportional damping. Subtracts α · θ̇ from θ̈ each
// frame, so the time constant of every mode decays at rate α regardless of
// frequency. Use to slowly bleed off rotation / bulk motion. 0 means the
// chain coasts indefinitely (only DAMPING_BEND dissipates).
const DAMPING_MASS = 0.1; // was 0

// --- Rope factory ------------------------------------------------------

// `opts` lets the caller override segmentLength and particleMass — used by
// the small debug rope so its per-link physics matches N=100's exactly
// (same L, same m), while keeping a tractable number of joints.
function makeRope(N, baseX, baseY, opts = {}){
  const Ns = N - 1;                                      // number of segments / angles
  const segmentLength = opts.segmentLength ?? (canvas.width * ROPE_LENGTH_FRACTION) / Ns;
  const particleMass  = opts.particleMass  ?? M_ROPE / Ns;
  // μ_{jk} = Σ_{i ≥ max(j,k)} m_i  with uniform mass.
  // For uniform mass this is (Ns − max(j,k)) · particleMass when we index
  // angles from 0. (Angle k controls particles k..Ns−1 in 0-indexed terms.)
  // We precompute the diagonal μ_{jj} since it appears in many spots.
  const muDiag = new Float64Array(Ns);
  for(let j = 0; j < Ns; j++){
    muDiag[j] = (Ns - j) * particleMass;
  }
  return {
    N, Ns, segmentLength, particleMass, muDiag,
    baseX, baseY,
    theta:    new Float64Array(Ns),                       // all angles = 0 → chain horizontal
    thetaDot: new Float64Array(Ns),
    // Particle positions (computed each frame for rendering).
    px: new Float64Array(N),
    py: new Float64Array(N),
    // Reusable scratch buffers for the equation solve.
    M:        new Float64Array(Ns * Ns),
    rhs:      new Float64Array(Ns),
    accel:    new Float64Array(Ns),                       // θ̈ output of the solve
    // Scratch for the implicit-damping linear solve (separate from the
    // conservative solve above so we don't trample its in-place buffers).
    dampA:    new Float64Array(Ns * Ns),                  // (M − h·c·D)
    dampB:    new Float64Array(Ns),                       // M · θ̇_old
    dampX:    new Float64Array(Ns),                       // θ̇_new
    // RK4 scratch (state has 2·Ns components: θ then θ̇).
    y:        new Float64Array(2 * Ns),
    k1:       new Float64Array(2 * Ns),
    k2:       new Float64Array(2 * Ns),
    k3:       new Float64Array(2 * Ns),
    k4:       new Float64Array(2 * Ns),
    yTmp:     new Float64Array(2 * Ns),
    thetaTmp: new Float64Array(Ns),
    thetaDotTmp: new Float64Array(Ns),
  };
}

// Match the debug rope's per-link properties to N=100 so individual joints
// see the same L, m, μ_jj at corresponding indices — only the total joint
// count differs.
const N100_segmentLength = (canvas.width * ROPE_LENGTH_FRACTION) / (N2 - 1);
const N100_particleMass  = M_ROPE / (N2 - 1);
const N_DEBUG = 4; // was 5                                    // 4 links → Ns = 4

const ropes = [
  makeRope(N1, canvas.width / 2, canvas.height * 0.35),
  makeRope(N2, canvas.width / 2, canvas.height * 0.45),
  /*makeRope(N_DEBUG, canvas.width / 2, canvas.height * 0.55, {
    segmentLength: N100_segmentLength,
    particleMass:  N100_particleMass,
  }), */
  makeRope(N_DEBUG, canvas.width / 2, canvas.height * 0.55),
];

// Expose ropes on window for console-side inspection during debugging:
// `alex2.ropes[2].theta`, `alex2.ropes[2].thetaDot`, `alex2.ropes[2].M`, etc.
if(typeof window !== 'undefined') window.alex2 = { ropes };

// --- Anchor state (shared across both ropes) ---------------------------

// Anchor position is offset from each rope's base by (anchorDeltaX, anchorDeltaY).
// Anchor velocity (anchorVx, anchorVy) is its own piece of state: it's
// modified by arrow keys (additive) and by drag (measured from position).
let anchorDeltaX = 0;
let anchorDeltaY = 0;
let anchorVx = 0;
let anchorVy = 0;
let prevAnchorDeltaX = 0;
let prevAnchorDeltaY = 0;

// Touch / drag input
let anchorHeld   = false;
let grabOffsetX  = 0;
let grabOffsetY  = 0;
let grabBaseX    = 0;
let grabBaseY    = 0;

inputHooks.emptyDown = (x, y) => {
  const grabR = Math.min(canvas.width, canvas.height) * ANCHOR_GRAB_RADIUS_FRAC;
  for(const rope of ropes){
    const ax = rope.baseX + anchorDeltaX;
    const ay = rope.baseY + anchorDeltaY;
    if(Math.hypot(x - ax, y - ay) <= grabR){
      grabOffsetX = ax - x;
      grabOffsetY = ay - y;
      grabBaseX   = rope.baseX;
      grabBaseY   = rope.baseY;
      anchorHeld  = true;
      return true;
    }
  }
  return false;
};
inputHooks.emptyMove = (x, y) => {
  if(!anchorHeld) return;
  anchorDeltaX = (x + grabOffsetX) - grabBaseX;
  anchorDeltaY = (y + grabOffsetY) - grabBaseY;
};
inputHooks.emptyUp = () => {
  if(!anchorHeld) return;
  anchorHeld = false;
  // Drag release: stop the anchor cleanly. No deceleration impulse on the
  // chain — it keeps whatever momentum the drag imparted and swings free.
  anchorVx = 0;
  anchorVy = 0;
};

window.addEventListener('keydown', (e) => {
  let dvx = 0, dvy = 0;
  const K = ANCHOR_KEY_VELOCITY_STEP;
  switch(e.key){
    case 'ArrowLeft':  dvx = -K; break;
    case 'ArrowRight': dvx =  K; break;
    case 'ArrowUp':    dvy = -K; break;
    case 'ArrowDown':  dvy =  K; break;
  }
  if(dvx || dvy){
    anchorVx += dvx;
    anchorVy += dvy;
    applyAnchorVelocityImpulse(dvx, dvy);
    e.preventDefault();
  }
});

// --- Equations of motion -----------------------------------------------

// Build M(θ) into rope.M (row-major, size Ns × Ns).
// M_{jk} = L² · cos(θ_j − θ_k) · μ_{jk}, where μ_{jk} = (Ns − max(j,k)) · m
function buildMassMatrix(rope, theta){
  const Ns = rope.Ns;
  const L  = rope.segmentLength;
  const m  = rope.particleMass;
  const M  = rope.M;
  const L2 = L * L;
  for(let j = 0; j < Ns; j++){
    for(let k = 0; k < Ns; k++){
      const mu = (Ns - Math.max(j, k)) * m;
      M[j * Ns + k] = L2 * Math.cos(theta[j] - theta[k]) * mu;
    }
  }
}

// Build RHS of the equation: rhs = Q_anchor − C(θ, θ̇) + Q_bend(θ)
// Q_anchor_j = L · μ_{jj} · (sin θ_j · ax − cos θ_j · ay)
// C_j        = Σ_k L² · μ_{jk} · sin(θ_j − θ_k) · θ̇_k²
// Q_bend     = discrete Laplacian of θ scaled by k_θ = BENDING_EI / L,
//              with free boundary conditions at both ends.
function buildRhs(rope, theta, thetaDot, ax, ay){
  const Ns      = rope.Ns;
  const L       = rope.segmentLength;
  const m       = rope.particleMass;
  const muDiag  = rope.muDiag;
  const rhs     = rope.rhs;
  const L2      = L * L;
  const kTheta  = BENDING_EI / L;
  for(let j = 0; j < Ns; j++){
    let qAnchor = L * muDiag[j] * (Math.sin(theta[j]) * ax - Math.cos(theta[j]) * ay);
    let cj = 0;
    for(let k = 0; k < Ns; k++){
      const mu = (Ns - Math.max(j, k)) * m;
      cj += L2 * mu * Math.sin(theta[j] - theta[k]) * thetaDot[k] * thetaDot[k];
    }
    // Bending: discrete-Laplacian of θ at j, with free-end boundary
    // conditions. (No bending term beyond the chain ends.)
    let qBend = 0;
    if(kTheta !== 0 && Ns >= 2){
      if(j === 0){
        qBend = kTheta * (theta[1] - theta[0]);
      } else if(j === Ns - 1){
        qBend = kTheta * (theta[Ns - 2] - theta[Ns - 1]);
      } else {
        qBend = kTheta * (theta[j - 1] - 2 * theta[j] + theta[j + 1]);
      }
    }
    // DAMPING_BEND is handled implicitly via applyImplicitDamping() after
    // the RK4 step — not added to the conservative RHS here.
    rhs[j] = qAnchor - cj + qBend;
  }
}

// Generic Gaussian elimination with partial pivoting on a dense N×N
// row-major matrix A and RHS vector b, writing the solution to x.
// In-place: A and b are destroyed during the elimination.
function gaussSolve(N, A, b, x){
  // Forward elimination with partial pivoting.
  for(let p = 0; p < N; p++){
    let pivotRow = p;
    let pivotMag = Math.abs(A[p * N + p]);
    for(let r = p + 1; r < N; r++){
      const mag = Math.abs(A[r * N + p]);
      if(mag > pivotMag){ pivotMag = mag; pivotRow = r; }
    }
    if(pivotRow !== p){
      for(let c = p; c < N; c++){
        const tmp = A[p * N + c];
        A[p * N + c] = A[pivotRow * N + c];
        A[pivotRow * N + c] = tmp;
      }
      const tmp = b[p]; b[p] = b[pivotRow]; b[pivotRow] = tmp;
    }
    const pivot = A[p * N + p];
    if(Math.abs(pivot) < 1e-12){
      // Singular; bail with zeros to avoid NaN cascades.
      for(let i = 0; i < N; i++) x[i] = 0;
      return;
    }
    for(let r = p + 1; r < N; r++){
      const factor = A[r * N + p] / pivot;
      if(factor === 0) continue;
      for(let c = p; c < N; c++){
        A[r * N + c] -= factor * A[p * N + c];
      }
      b[r] -= factor * b[p];
    }
  }
  // Back substitution.
  for(let i = N - 1; i >= 0; i--){
    let sum = b[i];
    for(let c = i + 1; c < N; c++){
      sum -= A[i * N + c] * x[c];
    }
    x[i] = sum / A[i * N + i];
  }
}

// Solve M · accel = rhs for the conservative dynamics step. In-place:
// rope.M and rope.rhs are destroyed; rope.accel is filled.
function solveLinear(rope){
  gaussSolve(rope.Ns, rope.M, rope.rhs, rope.accel);
}

// IMPLICIT DAMPING (operator splitting). After the RK4 step has advanced
// (θ, θ̇) under the conservative dynamics, apply the damping force using
// backward Euler:
//   θ̇_new = θ̇_old + h · M⁻¹ · F_damp(θ̇_new)
//   F_damp = c · D · θ̇   with D = discrete Laplacian (free-end BCs)
// Rearranged:
//   (M − h·c·D) · θ̇_new = M · θ̇_old
// One dense Gaussian-elimination solve per call. Uses the post-step mass
// matrix M(θ_new) — rope.theta has already been updated by rk4Step.
function applyImplicitDamping(rope, h){
  if(DAMPING_BEND === 0) return;
  const Ns = rope.Ns;
  if(Ns < 2) return;
  buildMassMatrix(rope, rope.theta);                      // M(θ_new)
  const M       = rope.M;
  const thetaDot = rope.thetaDot;
  const dampA   = rope.dampA;
  const dampB   = rope.dampB;
  const dampX   = rope.dampX;
  // dampB = M · θ̇_old
  for(let i = 0; i < Ns; i++){
    let s = 0;
    for(let j = 0; j < Ns; j++) s += M[i * Ns + j] * thetaDot[j];
    dampB[i] = s;
  }
  // dampA = M − h·c·D, where D acts on θ̇ via the discrete Laplacian:
  //   interior j: (Dθ̇)_j = θ̇_{j-1} − 2θ̇_j + θ̇_{j+1}
  //   end j=0:    (Dθ̇)_0 = θ̇_1 − θ̇_0
  //   end j=Ns-1: (Dθ̇)_{Ns-1} = θ̇_{Ns-2} − θ̇_{Ns-1}
  // So −h·c·D contributes [+hc, −hc] / [−hc, +2hc, −hc] / [−hc, +hc] to
  // the corresponding rows.
  const hc = h * DAMPING_BEND;
  dampA.set(M);
  dampA[0]         += hc;
  dampA[1]         += -hc;
  for(let j = 1; j < Ns - 1; j++){
    dampA[j * Ns + (j - 1)] += -hc;
    dampA[j * Ns + j]       += 2 * hc;
    dampA[j * Ns + (j + 1)] += -hc;
  }
  dampA[(Ns - 1) * Ns + (Ns - 2)] += -hc;
  dampA[(Ns - 1) * Ns + (Ns - 1)] += hc;
  gaussSolve(Ns, dampA, dampB, dampX);
  for(let i = 0; i < Ns; i++) thetaDot[i] = dampX[i];
}

// Direct angular-momentum impulse from a step change in anchor velocity.
// Integrating M·θ̈ = Q_anchor over an instantaneous Δv gives
//   M · Δθ̇ = L · μ_{jj} · (sin θ_j · Δvx − cos θ_j · Δvy)
// Solving that linear system once per rope is exactly the right "kick" to
// the chain. No finite-difference acceleration spike is needed.
function applyAnchorVelocityImpulse(dvx, dvy){
  for(const rope of ropes){
    const Ns = rope.Ns;
    const L  = rope.segmentLength;
    const muDiag = rope.muDiag;
    const rhs = rope.rhs;
    buildMassMatrix(rope, rope.theta);
    for(let j = 0; j < Ns; j++){
      rhs[j] = L * muDiag[j] * (Math.sin(rope.theta[j]) * dvx - Math.cos(rope.theta[j]) * dvy);
    }
    solveLinear(rope);                                    // fills rope.accel = Δθ̇
    for(let j = 0; j < Ns; j++){
      rope.thetaDot[j] += rope.accel[j];
    }
  }
}

// Evaluate f(y) for the first-order system: y = [θ, θ̇], y' = [θ̇, θ̈].
// Writes the derivative into `out`.
function deriv(rope, theta, thetaDot, ax, ay, out){
  buildMassMatrix(rope, theta);
  buildRhs(rope, theta, thetaDot, ax, ay);
  solveLinear(rope);                                      // fills rope.accel = θ̈
  const Ns = rope.Ns;
  // Mass-proportional damping: θ̈ ← θ̈ − α · θ̇ (uniform exponential decay
  // of every mode at rate DAMPING_MASS).
  if(DAMPING_MASS !== 0){
    for(let i = 0; i < Ns; i++){
      rope.accel[i] -= DAMPING_MASS * thetaDot[i];
    }
  }
  for(let i = 0; i < Ns; i++){
    out[i]      = thetaDot[i];                            // dθ/dt = θ̇
    out[Ns + i] = rope.accel[i];                          // dθ̇/dt = θ̈
  }
}

// One RK4 step on (θ, θ̇) advancing by h. Anchor acceleration (ax, ay) is
// treated as constant over the step.
function rk4Step(rope, h, ax, ay){
  const Ns = rope.Ns;
  const theta = rope.theta;
  const thetaDot = rope.thetaDot;
  const thetaTmp = rope.thetaTmp;
  const thetaDotTmp = rope.thetaDotTmp;
  const k1 = rope.k1, k2 = rope.k2, k3 = rope.k3, k4 = rope.k4;

  // k1 = f(y)
  deriv(rope, theta, thetaDot, ax, ay, k1);

  // k2 = f(y + h/2 · k1)
  for(let i = 0; i < Ns; i++){
    thetaTmp[i]    = theta[i]    + (h * 0.5) * k1[i];
    thetaDotTmp[i] = thetaDot[i] + (h * 0.5) * k1[Ns + i];
  }
  deriv(rope, thetaTmp, thetaDotTmp, ax, ay, k2);

  // k3 = f(y + h/2 · k2)
  for(let i = 0; i < Ns; i++){
    thetaTmp[i]    = theta[i]    + (h * 0.5) * k2[i];
    thetaDotTmp[i] = thetaDot[i] + (h * 0.5) * k2[Ns + i];
  }
  deriv(rope, thetaTmp, thetaDotTmp, ax, ay, k3);

  // k4 = f(y + h · k3)
  for(let i = 0; i < Ns; i++){
    thetaTmp[i]    = theta[i]    + h * k3[i];
    thetaDotTmp[i] = thetaDot[i] + h * k3[Ns + i];
  }
  deriv(rope, thetaTmp, thetaDotTmp, ax, ay, k4);

  // y_new = y + h/6 · (k1 + 2·k2 + 2·k3 + k4)
  const h6 = h / 6;
  for(let i = 0; i < Ns; i++){
    theta[i]    += h6 * (k1[i]      + 2 * k2[i]      + 2 * k3[i]      + k4[i]);
    thetaDot[i] += h6 * (k1[Ns + i] + 2 * k2[Ns + i] + 2 * k3[Ns + i] + k4[Ns + i]);
  }
}

// --- Update loop -------------------------------------------------------

function updateParticlePositions(rope){
  const Ns   = rope.Ns;
  const L    = rope.segmentLength;
  const px   = rope.px;
  const py   = rope.py;
  const theta = rope.theta;
  let x = rope.baseX + anchorDeltaX;
  let y = rope.baseY + anchorDeltaY;
  px[0] = x;
  py[0] = y;
  for(let k = 0; k < Ns; k++){
    x += L * Math.cos(theta[k]);
    y += L * Math.sin(theta[k]);
    px[k + 1] = x;
    py[k + 1] = y;
  }
}

export function update(dt){
  // Slow-motion: physics advances dt / SLOWDOWN per real frame.
  const h = dt / SLOWDOWN;
  if(h <= 0) return;

  if(anchorHeld){
    // During drag: emptyMove has already updated anchorDeltaX/Y to track
    // the mouse exactly. Measure this frame's anchor velocity from the
    // position delta, then deliver Δv (vs. the previous frame's velocity)
    // to the chain as an angular-momentum impulse — same mechanism the
    // arrow keys use. The conservative RHS sees ax = ay = 0 below, so the
    // chain feels the drag only through these per-frame impulses, never
    // through an integrated-force shock from finite-differenced ax/ay.
    const newAnchorVx = (anchorDeltaX - prevAnchorDeltaX) / h;
    const newAnchorVy = (anchorDeltaY - prevAnchorDeltaY) / h;
    const dvx = newAnchorVx - anchorVx;
    const dvy = newAnchorVy - anchorVy;
    if(dvx !== 0 || dvy !== 0) applyAnchorVelocityImpulse(dvx, dvy);
    anchorVx = newAnchorVx;
    anchorVy = newAnchorVy;
  } else {
    // Not dragging: anchor drifts at whatever velocity arrow keys (or
    // releasing the drag) left it at. Constant velocity → no impulse, just
    // rigid translation of the whole frame.
    anchorDeltaX += anchorVx * h;
    anchorDeltaY += anchorVy * h;
  }

  for(const rope of ropes){
    rk4Step(rope, h, 0, 0);
    applyImplicitDamping(rope, h);
    updateParticlePositions(rope);
  }

  prevAnchorDeltaX = anchorDeltaX;
  prevAnchorDeltaY = anchorDeltaY;
}

// --- Drawing -----------------------------------------------------------

function drawRopeSegments(ctx){
  ctx.lineWidth = 3;
  for(const rope of ropes){
    for(let i = 0; i < rope.Ns; i++){
      const hue = (i / Math.max(1, rope.Ns - 1)) * 360;
      ctx.strokeStyle = `hsl(${hue}, 85%, 60%)`;
      ctx.beginPath();
      ctx.moveTo(rope.px[i], rope.py[i]);
      ctx.lineTo(rope.px[i + 1], rope.py[i + 1]);
      ctx.stroke();
    }
  }
}

function drawEndpoints(ctx){
  const r = Math.min(canvas.width, canvas.height) * ANCHOR_MARKER_RADIUS_FRAC;
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for(const rope of ropes){
    ctx.fillStyle = ANCHOR_COLOR;
    ctx.beginPath();
    ctx.arc(rope.px[0], rope.py[0], r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(230, 238, 246, 0.65)';
    ctx.fillText(`N=${rope.N}`, rope.baseX - r * 2, rope.baseY);
  }
}

renderExtras.push(drawEndpoints);
renderExtras.push(drawRopeSegments);

// Initialize particle positions so the chain is visible before update() runs.
for(const rope of ropes) updateParticlePositions(rope);

// Reset re-initializes both ropes to horizontal at rest, clears anchor offset.
document.getElementById('resetDisk')?.addEventListener('click', () => {
  anchorDeltaX = 0;
  anchorDeltaY = 0;
  anchorVx = 0;
  anchorVy = 0;
  prevAnchorDeltaX = 0;
  prevAnchorDeltaY = 0;
  for(const rope of ropes){
    rope.theta.fill(0);
    rope.thetaDot.fill(0);
    updateParticlePositions(rope);
  }
});
