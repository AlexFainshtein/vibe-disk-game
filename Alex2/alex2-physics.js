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
// solve M · θ̈ = Q − C. That's O(N³) per evaluation, ×4 per frame, per rope.
// For N up to ~200 this is comfortably real-time.
//
// Anchor inputs reach the chain through two different mechanisms:
//   • Arrow keys: bounded Δv (=ANCHOR_KEY_VELOCITY_STEP per press) is
//     delivered as an instantaneous angular-momentum impulse
//       M · Δθ̇ = L · μ_{jj} · (sin θ_j · Δvx − cos θ_j · Δvy)
//     applied inside the keydown handler.  Cheap and exact.
//   • Mouse drag: the per-frame velocity change is converted to a smooth
//     anchor acceleration ax = Δv/h, ay = Δv/h and passed to Q_anchor
//     during the RK4 evaluations.  Same total angular momentum delivered
//     over the frame, but spread across the substeps so the chain's θ̇
//     ramps up gradually (and the quadratic Coriolis term doesn't see the
//     full Δv-induced velocity at every substep).
//
// Multi-rope comparison view: same anchor input drives several ropes with
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

// Internal RK4 substepping: per real frame, do RK4_SUBSTEPS_PER_FRAME
// RK4 steps each of size h/RK4_SUBSTEPS_PER_FRAME, holding ax/ay constant
// across them.  Total physics time per real frame is unchanged (= h), and
// mouse driving stays in lockstep with chain motion (no anchor-vs-chain
// mismatch).  Refining h reduces RK4's substep-amplification of nonlinear
// Coriolis terms — should let the chain tolerate larger |θ̇| before
// exploding.  Cost: each frame does RK4_SUBSTEPS_PER_FRAME times more
// linear solves.  At N=100, one RK4 step ≈ 4·O(N³) ≈ 4M ops; 4× substep
// is ~16M ops/frame, well within budget.
const RK4_SUBSTEPS_PER_FRAME = 16;

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
const BENDING_EI = 100;

// --- Damping (non-conservative; added directly to the EOM, not Lagrangian) ---
//
// DAMPING_BEND: strain-rate / stiffness-proportional damping. Force per
// joint = c · (θ̇_{j-1} − 2θ̇_j + θ̇_{j+1}) — the discrete Laplacian of θ̇.
// Pulls each joint's angular velocity toward its neighbors'. Has *zero
// effect* on rigid rotation (all θ̇ equal → Laplacian = 0), so the chain
// can still spin freely; but suppresses high-frequency / alternating-sign
// modes exponentially. Analog of stiffness-proportional Rayleigh damping.
//
// Added inline to the conservative RHS (see buildRhs), so it goes through
// RK4 with everything else. This is explicit integration, so c is bounded
// by RK4's stability region: roughly c · max_eigenvalue(M⁻¹·D) · h < 2.78.
// At N=100 with h≈1/60 that puts the upper limit somewhere around c ≈ 1;
// keep this in mind when raising the value.
const DAMPING_BEND = 1;

// DAMPING_MASS: mass-proportional damping. Subtracts α · θ̇ from θ̈ each
// frame, so the time constant of every mode decays at rate α regardless of
// frequency. Use to slowly bleed off rotation / bulk motion. 0 means the
// chain coasts indefinitely (only DAMPING_BEND dissipates).
const DAMPING_MASS = 0.1; // was 0

// --- Energy monitoring (diagnostic) ------------------------------------
//
// Compute E = (1/2) θ̇ᵀ M(θ) θ̇ per rope per frame. For the conservative
// system this is exactly conserved (Noether); with damping it must
// monotonically decrease. Anything else — sudden spikes, NaN, runaway
// growth — is a numerical-stability problem we want to catch in the act.
const ENERGY_MONITOR  = false;     // off — no console spam during this test
const E_SPIKE_RATIO   = 100;       // log when E_new / E_prev exceeds this

// --- Solo / trace mode (diagnostic) -----------------------------------
//
// SOLO_MODE: keep only one chain active (instead of three side-by-side) so
// trace output is readable.  Edit SOLO_N to test a different size.
// TRACE_ENABLED + TRACE_DURATION_FRAMES: log θ_j every frame for the first
// N frames after page load / Reset.  Stops automatically on NaN.
const SOLO_MODE             = true;
const SOLO_N                = N2;    // which N to test (defaults to 100)
const TRACE_ENABLED         = false; // off — no per-frame console output during test
const TRACE_DURATION_FRAMES = 600;   // ~10 seconds at 60 Hz — long enough to capture slow-drift explosions
const TRACE_HEAD            = 5;     // how many θ_j to show from the start of the chain
const TRACE_TAIL            = 5;     // how many θ_j to show from the end

// Spectral condition-number estimator for M (power iteration for λ_max,
// inverse power iteration for λ_min, ratio gives κ₂(M)).  Each frame runs
// CONDITION_ITERS mat-vecs + CONDITION_ITERS linear solves — roughly 2.5×
// the cost of one RK4 step.  Disable when not debugging.
const CONDITION_ESTIMATE    = false; // off — expensive, not needed for this test
const CONDITION_ITERS       = 10;

// Per-substep RHS + θ̈ logging for the first SUBSTEP_LOG_HEAD joints.
// Captures the input (rhs of M·θ̈ = rhs) and output (θ̈) of each of the 4
// RK4 substeps each frame, so we can see if/where RK4's intermediate
// derivative estimates are diverging from each other.  Dumped to CSV when
// tracing stops.
const SUBSTEP_LOG_ENABLED   = false; // off — no per-substep capture during test
const SUBSTEP_LOG_HEAD      = 20;

// INPUT_LOG: mouse-input diagnostics, gated alongside the chain trace
// (starts on first anchor input, stops when tracing stops), so its frame
// index aligns with the substep log's.  Per-frame units so all three
// quantities are on the same numerical scale as L ≈ 4 px:
//   x, y  — anchor position offset, px
//   vx, vy — px per frame  (= raw position delta this frame)
//   ax, ay — px per frame²  (= change in velocity-per-frame from last frame)
const INPUT_LOG_ENABLED         = false; // off — no CSV writing during test

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
    // RK4 scratch (state has 2·Ns components: θ then θ̇).
    y:        new Float64Array(2 * Ns),
    k1:       new Float64Array(2 * Ns),
    k2:       new Float64Array(2 * Ns),
    k3:       new Float64Array(2 * Ns),
    k4:       new Float64Array(2 * Ns),
    yTmp:     new Float64Array(2 * Ns),
    thetaTmp: new Float64Array(Ns),
    thetaDotTmp: new Float64Array(Ns),
    // Energy monitor state (E = (1/2) θ̇ᵀ M θ̇).
    E:        0,
    prevE:    0,
    // Coordinate-magnification monitors:
    //   maxThetaDot  = max_j |θ̇_j|              (the angular velocity our integrator actually sees)
    //   maxLThetaDot = L · max_j |θ̇_j|          (the corresponding linear velocity in the anchor frame)
    // Hypothesis test: maxThetaDot scales as 1/L across ropes; maxLThetaDot should be ~N-invariant.
    // prev* fields capture the values from the frame immediately before — useful in the
    // spike/NaN warnings to see what the state was just before the integrator failed.
    maxThetaDot:      0,
    maxLThetaDot:     0,
    prevMaxThetaDot:  0,
    prevMaxLThetaDot: 0,
    // M conditioning monitor: smallest/largest |pivot| seen during the 4
    // RK4 substeps of the most recent frame.  ratio ≈ 1/cond_number.
    pivotMin:         Infinity,
    pivotMax:         0,
    pivotRatio:       0,
    // True condition-number estimator (power iteration + inverse power
    // iteration on M).  cond = λ_max / λ_min for SPD M — the spectral
    // condition number, the actual quantity the user wants.
    condM:            new Float64Array(Ns * Ns),  // pristine copy of M, persists across iters
    condX:            new Float64Array(Ns),       // current iteration vector
    condY:            new Float64Array(Ns),       // mat-vec / linear-solve output
    condLambdaMax:    0,
    condLambdaMin:    0,
    condNum:          0,
    // Per-substep snapshot: deriv copies rope.rhs into lastRhs before
    // gaussSolve destroys it, so captureSubstep can read the actual RHS
    // value used for this substep's linear solve.
    lastRhs:          new Float64Array(Ns),
    // Once E goes non-finite, the warning would fire every frame forever
    // (60×/sec, each a long line) and DevTools eventually freezes. Latch the
    // warning so it fires once per NaN episode; cleared by Reset or by E
    // becoming finite again.
    nanWarned:        false,
  };
}

// Match the debug rope's per-link properties to N=100 so individual joints
// see the same L, m, μ_jj at corresponding indices — only the total joint
// count differs.
const N100_segmentLength = (canvas.width * ROPE_LENGTH_FRACTION) / (N2 - 1);
const N100_particleMass  = M_ROPE / (N2 - 1);
const N_DEBUG = 4; // was 5                                    // 4 links → Ns = 4

const ropes = SOLO_MODE
  ? [makeRope(SOLO_N, canvas.width / 2, canvas.height * 0.5)]
  : [
      makeRope(N1, canvas.width / 2, canvas.height * 0.35),
      makeRope(N2, canvas.width / 2, canvas.height * 0.45),
      /*makeRope(N_DEBUG, canvas.width / 2, canvas.height * 0.55, {
        segmentLength: N100_segmentLength,
        particleMass:  N100_particleMass,
      }), */
      makeRope(N_DEBUG, canvas.width / 2, canvas.height * 0.55),
    ];

// --- Input-log CSV download -------------------------------------------

// Triggers a browser download of the accumulated input log as a CSV file.
// Called automatically when the duration runs out, or manually via
// window.alex2.dumpInputLog().  Reason string ends up in the filename.
function dumpInputLog(reason = 'manual'){
  if(typeof window === 'undefined' || typeof document === 'undefined') return;
  if(inputLogRows.length === 0){
    console.log('[input] no rows to dump');
    return;
  }
  const header = 'frame,x_px,y_px,vx_pxpf,vy_pxpf,ax_pxpf2,ay_pxpf2\n';
  const body = inputLogRows.map(r =>
    r.map((v, i) => i === 0 ? String(v) : (Number.isFinite(v) ? v.toFixed(6) : String(v))).join(',')
  ).join('\n');
  const csv = header + body + '\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href     = url;
  a.download = `alex2-input-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  console.log(`[input] dumped ${inputLogRows.length} rows to CSV (reason: ${reason})`);
}

// Dump the per-substep RHS + θ̈ log accumulated in substepLogRows.
// 4 rows per traced frame (one per RK4 substep), each capturing the
// first SUBSTEP_LOG_HEAD joints of `rhs` (input to the linear solve)
// and the resulting `accel` (= θ̈ used by RK4).
function dumpSubstepLog(reason = 'manual'){
  if(typeof window === 'undefined' || typeof document === 'undefined') return;
  if(substepLogRows.length === 0){
    console.log('[substep] no rows to dump');
    return;
  }
  const head = SUBSTEP_LOG_HEAD;
  let header = 'frame,substep,shift_y_px,ay_pxps2';
  for(let i = 0; i < head; i++) header += `,rhs_${i}`;
  for(let i = 0; i < head; i++) header += `,ddt_${i}`;
  header += '\n';
  const body = substepLogRows.map(r => {
    const parts = [String(r[0] | 0), String(r[1] | 0)];
    for(let i = 2; i < 4 + 2 * head; i++){
      const v = r[i];
      parts.push(Number.isFinite(v) ? v.toExponential(4) : String(v));
    }
    return parts.join(',');
  }).join('\n');
  const csv = header + body + '\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href     = url;
  a.download = `alex2-substep-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  console.log(`[substep] dumped ${substepLogRows.length} rows to CSV (reason: ${reason})`);
}

// Expose ropes on window for console-side inspection during debugging:
// `alex2.ropes[0].theta`, etc.  Also exposes dumpInputLog() for manual
// CSV download.
if(typeof window !== 'undefined') window.alex2 = { ropes, dumpInputLog, dumpSubstepLog };

// Trace state: counts frames since page load / last Reset. Tracing waits
// for the first anchor input (via applyAnchorVelocityImpulse) before
// recording — otherwise frame 0 would be hundreds of all-zero lines.
// Stops after TRACE_DURATION_FRAMES or on the first non-finite E.
let traceFrameCount      = 0;
let tracingActive        = TRACE_ENABLED;
let anchorHasInteracted  = false;

// Input log state — gated alongside the chain trace so frame indices
// align with the substep log.  Each row uses traceFrameCount as its frame
// number.  Dumped together with the substep log when tracing stops.
const inputLogRows = [];   // each row: [frame, x, y, vx, vy, ax, ay]

// Substep log: per (frame, substep) record of the first SUBSTEP_LOG_HEAD
// values of the conservative RHS and the resulting θ̈.  Active whenever
// tracing is active; dumped to its own CSV when tracing stops (or on
// demand via window.alex2.dumpSubstepLog()).
const substepLogRows   = [];   // each row: [frame, substep, rhs_0..H, ddt_0..H]

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

// Build RHS of the equation: rhs = Q_anchor − C(θ, θ̇) + Q_bend(θ) + Q_damp(θ̇)
// Q_anchor_j = L · μ_{jj} · (sin θ_j · ax − cos θ_j · ay)
// C_j        = Σ_k L² · μ_{jk} · sin(θ_j − θ_k) · θ̇_k²
// Q_bend     = discrete Laplacian of θ scaled by k_θ = BENDING_EI / L,
//              with free boundary conditions at both ends.
// Q_damp     = DAMPING_BEND · discrete Laplacian of θ̇, same boundary
//              conditions. Strain-rate damping integrated by RK4 like
//              every other force.
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
    // Strain-rate damping (linear, discrete Laplacian on θ̇, free ends).
    let qDamp = 0;
    if(Ns >= 2){
      let lapThetaDot;
      if(j === 0){
        lapThetaDot = thetaDot[1] - thetaDot[0];
      } else if(j === Ns - 1){
        lapThetaDot = thetaDot[Ns - 2] - thetaDot[Ns - 1];
      } else {
        lapThetaDot = thetaDot[j - 1] - 2 * thetaDot[j] + thetaDot[j + 1];
      }
      qDamp = DAMPING_BEND * lapThetaDot;
    }
    // Nonlinear bending: V_pair(Δθ) = -4·kTheta·log(cos(Δθ/2)), so
    // V'(Δθ) = 2·kTheta·tan(Δθ/2). Small-Δθ limit gives kTheta·Δθ, identical
    // to the previous linear law; diverges as |Δθ| → π so adjacent segments
    // can't fold onto each other. Generalized force on θ_j is
    //   V'(θ_{j+1} − θ_j) − V'(θ_j − θ_{j−1}),
    // recovering the discrete Laplacian sign convention in the linear limit.
    let qBend = 0;
    if(Ns >= 2 && BENDING_EI !== 0){
      const piMinusEps = Math.PI - 0.01;
      let vpLeft = 0;
      if(j > 0){
        let dl = theta[j] - theta[j - 1];
        if(dl >  piMinusEps) dl =  piMinusEps;
        else if(dl < -piMinusEps) dl = -piMinusEps;
        vpLeft = 2 * kTheta * Math.tan(dl * 0.5);
      }
      let vpRight = 0;
      if(j < Ns - 1){
        let dr = theta[j + 1] - theta[j];
        if(dr >  piMinusEps) dr =  piMinusEps;
        else if(dr < -piMinusEps) dr = -piMinusEps;
        vpRight = 2 * kTheta * Math.tan(dr * 0.5);
      }
      qBend = vpRight - vpLeft;
    }
    rhs[j] = qAnchor - cj + qBend + qDamp;
  }
}

// Module-level pivot tracking, written by gaussSolve and read after a frame
// completes.  Reset before each rk4Step call so the recorded min/max cover
// all 4 substeps within one frame.  ratio = min/max ≈ 1/cond_number.
let _solveMinPivot = Infinity;
let _solveMaxPivot = 0;

// Per-frame mouse-input snapshot, captured by update() at the start of
// each frame so the substep log can show "what did the mouse do this
// frame" alongside the chain's internal RHS/θ̈ response.
let _frameShiftY = 0;   // Δy = anchorDeltaY this frame − last frame  (pixels)
let _frameAy     = 0;   // smooth-delivery anchor acceleration (px/s²)

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
    const apivot = Math.abs(pivot);
    if(apivot < _solveMinPivot) _solveMinPivot = apivot;
    if(apivot > _solveMaxPivot) _solveMaxPivot = apivot;
    if(apivot < 1e-12){
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

// Estimate κ₂(M) = λ_max / λ_min by power iteration + inverse power
// iteration on M(θ).  Both start from a random unit vector and converge
// in ~CONDITION_ITERS iterations to the dominant / sub-dominant eigenvalue
// directions; the Rayleigh quotient gives the eigenvalue estimate.
//
// Costs per call: CONDITION_ITERS mat-vec multiplies + CONDITION_ITERS
// linear solves on M.  Each linear solve destroys M, so we keep a pristine
// copy in rope.condM and restore it before each gaussSolve.
function estimateConditionNumber(rope){
  const Ns = rope.Ns;
  // Build a fresh M(θ_current) into rope.M, then snapshot it.  Note that
  // rope.M is in a destroyed state from the last RK4 substep, so this
  // build is necessary.
  buildMassMatrix(rope, rope.theta);
  rope.condM.set(rope.M);

  const Mpristine = rope.condM;
  const x = rope.condX;
  const y = rope.condY;

  // --- Power iteration for λ_max ---
  // Start with a random unit vector.
  let n2 = 0;
  for(let i = 0; i < Ns; i++){ x[i] = Math.random() - 0.5; n2 += x[i] * x[i]; }
  let nrm = Math.sqrt(n2);
  if(nrm > 0) for(let i = 0; i < Ns; i++) x[i] /= nrm;

  let lambdaMax = 0;
  for(let iter = 0; iter < CONDITION_ITERS; iter++){
    // y = M·x
    for(let i = 0; i < Ns; i++){
      let s = 0;
      for(let j = 0; j < Ns; j++) s += Mpristine[i * Ns + j] * x[j];
      y[i] = s;
    }
    // Rayleigh quotient (x is unit): λ ≈ x · M · x = x · y
    lambdaMax = 0;
    for(let i = 0; i < Ns; i++) lambdaMax += x[i] * y[i];
    // Normalize: x ← y / ||y||
    n2 = 0;
    for(let i = 0; i < Ns; i++) n2 += y[i] * y[i];
    nrm = Math.sqrt(n2);
    if(!Number.isFinite(nrm) || nrm < 1e-30) break;
    for(let i = 0; i < Ns; i++) x[i] = y[i] / nrm;
  }

  // --- Inverse power iteration for λ_min ---
  // Re-initialize x with a fresh random unit vector.
  n2 = 0;
  for(let i = 0; i < Ns; i++){ x[i] = Math.random() - 0.5; n2 += x[i] * x[i]; }
  nrm = Math.sqrt(n2);
  if(nrm > 0) for(let i = 0; i < Ns; i++) x[i] /= nrm;

  let lambdaMin = 0;
  for(let iter = 0; iter < CONDITION_ITERS; iter++){
    // Solve M·y = x.  gaussSolve destroys both rope.M and rope.rhs, so
    // restore M from the pristine copy and use rope.rhs as the buffer for x.
    rope.M.set(Mpristine);
    for(let i = 0; i < Ns; i++) rope.rhs[i] = x[i];
    gaussSolve(Ns, rope.M, rope.rhs, y);
    // Rayleigh quotient on M:  M·y = x, so y·M·y = y·x.  For PD M this is
    // strictly positive — a negative value would itself be diagnostic
    // (signals M's smallest eigenvalue has dropped below roundoff
    // precision of the linear solve).  We keep the signed form for that
    // reason.
    let dotYX = 0, dotYY = 0;
    for(let i = 0; i < Ns; i++){
      dotYX += y[i] * x[i];
      dotYY += y[i] * y[i];
    }
    if(!Number.isFinite(dotYY) || dotYY < 1e-30){ lambdaMin = 0; break; }
    lambdaMin = dotYX / dotYY;
    // Normalize: x ← y / ||y||
    nrm = Math.sqrt(dotYY);
    if(!Number.isFinite(nrm) || nrm < 1e-30) break;
    for(let i = 0; i < Ns; i++) x[i] = y[i] / nrm;
  }

  rope.condLambdaMax = lambdaMax;
  rope.condLambdaMin = lambdaMin;
  rope.condNum = (lambdaMin > 0 && Number.isFinite(lambdaMax)) ? lambdaMax / lambdaMin : Infinity;
}

// Direct angular-momentum impulse from a step change in anchor velocity.
// Integrating M·θ̈ = Q_anchor over an instantaneous Δv gives
//   M · Δθ̇ = L · μ_{jj} · (sin θ_j · Δvx − cos θ_j · Δvy)
// Solving that linear system once per rope is exactly the right "kick" to
// the chain. No finite-difference acceleration spike is needed.
function applyAnchorVelocityImpulse(dvx, dvy){
  if(dvx !== 0 || dvy !== 0) anchorHasInteracted = true;
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
  if(SUBSTEP_LOG_ENABLED) rope.lastRhs.set(rope.rhs);    // snapshot before solveLinear destroys it
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

// Total kinetic energy of the chain: E = (1/2) · θ̇ᵀ · M(θ) · θ̇.
// Rebuilds M from the current θ (the M stored on the rope was destroyed by
// the most recent Gaussian elimination, so we can't reuse it).
function computeEnergy(rope){
  const Ns       = rope.Ns;
  const thetaDot = rope.thetaDot;
  buildMassMatrix(rope, rope.theta);
  const M = rope.M;
  let E = 0;
  for(let i = 0; i < Ns; i++){
    let s = 0;
    for(let j = 0; j < Ns; j++) s += M[i * Ns + j] * thetaDot[j];
    E += thetaDot[i] * s;
  }
  return 0.5 * E;
}

// Coordinate-magnification metrics: writes maxThetaDot and maxLThetaDot
// to the rope. The first is what RK4 actually integrates; the second
// rescales it back to a physical (linear) velocity in the anchor frame.
function computeChainMetrics(rope){
  const Ns = rope.Ns;
  const thetaDot = rope.thetaDot;
  let maxAbs = 0;
  for(let i = 0; i < Ns; i++){
    const a = Math.abs(thetaDot[i]);
    if(!Number.isFinite(a)){          // NaN/Infinity propagates; comparison would fail silently
      rope.maxThetaDot  = a;
      rope.maxLThetaDot = a;
      return;
    }
    if(a > maxAbs) maxAbs = a;
  }
  rope.maxThetaDot  = maxAbs;
  rope.maxLThetaDot = maxAbs * rope.segmentLength;
}

// Append one row to substepLogRows capturing the RHS (snapshot taken by
// deriv before the linear solve) and the resulting θ̈ for the first
// SUBSTEP_LOG_HEAD joints.  Gated on tracingActive + anchorHasInteracted
// so it lines up with the chain trace timeline.
function captureSubstep(rope, substepIdx){
  if(!SUBSTEP_LOG_ENABLED || !tracingActive || !anchorHasInteracted) return;
  const head = Math.min(rope.Ns, SUBSTEP_LOG_HEAD);
  // Row layout: [frame, substep, shift_y, ay, rhs_0..head-1, ddt_0..head-1]
  const row = new Float64Array(4 + 2 * head);
  row[0] = traceFrameCount;
  row[1] = substepIdx;
  row[2] = _frameShiftY;
  row[3] = _frameAy;
  for(let i = 0; i < head; i++){
    row[4 + i]        = rope.lastRhs[i];
    row[4 + head + i] = rope.accel[i];
  }
  substepLogRows.push(row);
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

  // Reset pivot tracking for this frame; gaussSolve writes min/max across
  // all 4 substeps below, and we read them back into the rope after.
  _solveMinPivot = Infinity;
  _solveMaxPivot = 0;

  // k1 = f(y)
  deriv(rope, theta, thetaDot, ax, ay, k1);
  captureSubstep(rope, 1);

  // k2 = f(y + h/2 · k1)
  for(let i = 0; i < Ns; i++){
    thetaTmp[i]    = theta[i]    + (h * 0.5) * k1[i];
    thetaDotTmp[i] = thetaDot[i] + (h * 0.5) * k1[Ns + i];
  }
  deriv(rope, thetaTmp, thetaDotTmp, ax, ay, k2);
  captureSubstep(rope, 2);

  // k3 = f(y + h/2 · k2)
  for(let i = 0; i < Ns; i++){
    thetaTmp[i]    = theta[i]    + (h * 0.5) * k2[i];
    thetaDotTmp[i] = thetaDot[i] + (h * 0.5) * k2[Ns + i];
  }
  deriv(rope, thetaTmp, thetaDotTmp, ax, ay, k3);
  captureSubstep(rope, 3);

  // k4 = f(y + h · k3)
  for(let i = 0; i < Ns; i++){
    thetaTmp[i]    = theta[i]    + h * k3[i];
    thetaDotTmp[i] = thetaDot[i] + h * k3[Ns + i];
  }
  deriv(rope, thetaTmp, thetaDotTmp, ax, ay, k4);
  captureSubstep(rope, 4);

  // y_new = y + h/6 · (k1 + 2·k2 + 2·k3 + k4)
  const h6 = h / 6;
  for(let i = 0; i < Ns; i++){
    theta[i]    += h6 * (k1[i]      + 2 * k2[i]      + 2 * k3[i]      + k4[i]);
    thetaDot[i] += h6 * (k1[Ns + i] + 2 * k2[Ns + i] + 2 * k3[Ns + i] + k4[Ns + i]);
  }

  // Record worst-case M-conditioning seen across this frame's 4 substeps.
  rope.pivotMin   = _solveMinPivot;
  rope.pivotMax   = _solveMaxPivot;
  rope.pivotRatio = _solveMaxPivot > 0 ? _solveMinPivot / _solveMaxPivot : 0;
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

  // ax, ay are the anchor's smoothed acceleration over this frame, fed to
  // Q_anchor inside the RK4 evaluations.  For the mouse-drag path we use
  // this smooth delivery instead of an instantaneous Δv impulse — same
  // total Δθ̇ is transferred to the chain over the frame, but distributed
  // across RK4 substeps so the substep θ̇ values stay small (and Coriolis
  // ∝ θ̇² stays much smaller during evaluation).  Arrow keys still use the
  // impulse path inside the keydown handler.
  let ax = 0, ay = 0;
  if(anchorHeld){
    // During drag: emptyMove has already updated anchorDeltaX/Y to track
    // the mouse exactly.  Measure this frame's anchor velocity from the
    // position delta, derive its acceleration vs. the previous frame, and
    // pass that to Q_anchor.
    const newAnchorVx = (anchorDeltaX - prevAnchorDeltaX) / h;
    const newAnchorVy = (anchorDeltaY - prevAnchorDeltaY) / h;
    ax = (newAnchorVx - anchorVx) / h;
    ay = (newAnchorVy - anchorVy) / h;
    if(ax !== 0 || ay !== 0) anchorHasInteracted = true;

    // Input log: per-frame units (px, px/frame, px/frame²).  Gated on
    // tracingActive + anchorHasInteracted so the frame index aligns with
    // the substep log's frame index (both count from the first mouse
    // motion).  Accumulated in memory and dumped together with the substep
    // log when tracing stops.
    if(INPUT_LOG_ENABLED && tracingActive && anchorHasInteracted){
      const vx_pf  = newAnchorVx * h;   // = anchorDeltaX − prevAnchorDeltaX
      const vy_pf  = newAnchorVy * h;
      const ax_pf2 = ax * h * h;        // = (newAnchorV − anchorV) · h
      const ay_pf2 = ay * h * h;
      inputLogRows.push([traceFrameCount, anchorDeltaX, anchorDeltaY, vx_pf, vy_pf, ax_pf2, ay_pf2]);
    }

    anchorVx = newAnchorVx;
    anchorVy = newAnchorVy;
    // Snapshot for the substep CSV's leading columns: how much the mouse
    // moved in y this frame (Δy in px) and the resulting smooth-delivery
    // acceleration (px/s²).
    _frameShiftY = anchorDeltaY - prevAnchorDeltaY;
    _frameAy     = ay;
  } else {
    // Not dragging: anchor drifts at whatever velocity arrow keys (or
    // releasing the drag) left it at.  Constant velocity → ax = ay = 0,
    // just rigid translation of the whole frame.
    anchorDeltaX += anchorVx * h;
    anchorDeltaY += anchorVy * h;
    _frameShiftY = 0;
    _frameAy     = 0;
  }

  // Per real frame, do RK4_SUBSTEPS_PER_FRAME RK4 steps each advancing
  // physics by h_sub = h/N.  Anchor acceleration (ax, ay) is held constant
  // across substeps (the chain receives the same total impulse it would
  // have with a single h-step), but the integrator sees a smaller h, which
  // reduces RK4's amplification of nonlinear Coriolis terms.
  const h_sub = h / RK4_SUBSTEPS_PER_FRAME;
  for(const rope of ropes){
    for(let s = 0; s < RK4_SUBSTEPS_PER_FRAME; s++){
      rk4Step(rope, h_sub, ax, ay);
    }
    if(CONDITION_ESTIMATE) estimateConditionNumber(rope);
    if(ENERGY_MONITOR){
      rope.prevE             = rope.E;
      rope.prevMaxThetaDot   = rope.maxThetaDot;
      rope.prevMaxLThetaDot  = rope.maxLThetaDot;
      rope.E = computeEnergy(rope);
      computeChainMetrics(rope);
      const fmt = (x) => Number.isFinite(x) ? x.toExponential(2) : String(x);
      if(!Number.isFinite(rope.E)){
        if(!rope.nanWarned){
          console.warn(`[Alex2 E] N=${rope.N}: non-finite E=${rope.E} (prev E=${fmt(rope.prevE)}, prev |θ̇|=${fmt(rope.prevMaxThetaDot)}, prev L|θ̇|=${fmt(rope.prevMaxLThetaDot)})`);
          rope.nanWarned = true;
        }
      } else {
        rope.nanWarned = false;       // E is finite — re-arm NaN latch for next time
        if(rope.prevE > 0 && rope.E / rope.prevE > E_SPIKE_RATIO){
          console.warn(`[Alex2 E] N=${rope.N}: spike (×${(rope.E/rope.prevE).toExponential(2)})  E ${fmt(rope.prevE)}→${fmt(rope.E)}  |θ̇| ${fmt(rope.prevMaxThetaDot)}→${fmt(rope.maxThetaDot)}  L|θ̇| ${fmt(rope.prevMaxLThetaDot)}→${fmt(rope.maxLThetaDot)}`);
        }
      }
    }
    updateParticlePositions(rope);
  }

  // Trace logging: three lines per frame per rope — a header with frame
  // number, E, and |θ̇|max; then θ values (head+tail); then θ̇ values
  // (same format).  Waits for the first anchor input, runs for
  // TRACE_DURATION_FRAMES frames or until E goes non-finite.
  if(tracingActive && anchorHasInteracted){
    const fmtT = (x) => {
      if(!Number.isFinite(x)) return '    NaN';
      // toFixed falls back to full-precision exponential for |x| ≥ 1e21,
      // producing 20-char mantissas. Switch to short exponential ourselves
      // once the value leaves a "moderate" band.
      const ax = Math.abs(x);
      if(ax >= 1e4 || (ax > 0 && ax < 1e-3)){
        return x.toExponential(2).padStart(10);
      }
      return x.toFixed(3).padStart(7);
    };
    const fmtE = (x) => Number.isFinite(x) ? x.toExponential(2) : String(x);
    const fmtArr = (arr) => {
      const n = arr.length;
      if(n <= TRACE_HEAD + TRACE_TAIL){
        return Array.from(arr).map(fmtT).join(' ');
      }
      const headPart = [];
      for(let i = 0; i < TRACE_HEAD; i++) headPart.push(fmtT(arr[i]));
      const tailPart = [];
      for(let i = n - TRACE_TAIL; i < n; i++) tailPart.push(fmtT(arr[i]));
      return `${headPart.join(' ')}  …  ${tailPart.join(' ')}`;
    };
    for(const rope of ropes){
      const td = rope.maxThetaDot;
      const tdMaxStr = !Number.isFinite(td)
        ? String(td)
        : (Math.abs(td) >= 1e4 ? td.toExponential(2) : td.toFixed(2)).padStart(8);
      const prStr = Number.isFinite(rope.pivotRatio) ? rope.pivotRatio.toExponential(5) : String(rope.pivotRatio);
      const kStr  = Number.isFinite(rope.condNum)    ? rope.condNum.toExponential(3)    : String(rope.condNum);
      const lminStr = Number.isFinite(rope.condLambdaMin) ? rope.condLambdaMin.toExponential(3) : String(rope.condLambdaMin);
      const lmaxStr = Number.isFinite(rope.condLambdaMax) ? rope.condLambdaMax.toExponential(3) : String(rope.condLambdaMax);
      console.log(`[trace f=${String(traceFrameCount).padStart(3, '0')}] N=${rope.N} E=${fmtE(rope.E)} |θ̇|max=${tdMaxStr}  pivotRatio=${prStr}  κ=${kStr} (λ_min=${lminStr}, λ_max=${lmaxStr})`);
      console.log(`              θ =[${fmtArr(rope.theta)}]`);
      console.log(`              θ̇ =[${fmtArr(rope.thetaDot)}]`);
      if(!Number.isFinite(rope.E)){
        console.log(`[trace] stopped at frame ${traceFrameCount} — non-finite E`);
        tracingActive = false;
        if(SUBSTEP_LOG_ENABLED) dumpSubstepLog('non-finite E');
        if(INPUT_LOG_ENABLED)   dumpInputLog('non-finite E (paired with substep)');
        break;
      }
    }
    traceFrameCount++;
    if(tracingActive && traceFrameCount >= TRACE_DURATION_FRAMES){
      console.log(`[trace] stopped at frame ${traceFrameCount} — duration reached`);
      tracingActive = false;
      if(SUBSTEP_LOG_ENABLED) dumpSubstepLog('duration reached');
      if(INPUT_LOG_ENABLED)   dumpInputLog('trace duration reached (paired with substep)');
    }
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
    if(ENERGY_MONITOR){
      const eStr = Number.isFinite(rope.E) ? rope.E.toExponential(2) : String(rope.E);
      const tdStr = Number.isFinite(rope.maxThetaDot)  ? rope.maxThetaDot.toFixed(2)  : String(rope.maxThetaDot);
      const lvStr = Number.isFinite(rope.maxLThetaDot) ? rope.maxLThetaDot.toFixed(1) : String(rope.maxLThetaDot);
      ctx.fillText(`N=${rope.N}  E=${eStr}`,                     rope.baseX - r * 2, rope.baseY - 8);
      ctx.fillText(`|θ̇|=${tdStr}  L|θ̇|=${lvStr}`,                  rope.baseX - r * 2, rope.baseY + 8);
    } else {
      ctx.fillText(`N=${rope.N}`, rope.baseX - r * 2, rope.baseY);
    }
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
    rope.E = 0;
    rope.prevE = 0;
    rope.maxThetaDot     = 0;
    rope.maxLThetaDot    = 0;
    rope.prevMaxThetaDot  = 0;
    rope.prevMaxLThetaDot = 0;
    rope.nanWarned = false;
    rope.pivotMin   = Infinity;
    rope.pivotMax   = 0;
    rope.pivotRatio = 0;
    rope.condLambdaMin = 0;
    rope.condLambdaMax = 0;
    rope.condNum    = 0;
    updateParticlePositions(rope);
  }
  // Re-arm trace for the next test run.
  traceFrameCount      = 0;
  tracingActive        = TRACE_ENABLED;
  anchorHasInteracted  = false;
  // Re-arm input log too (any unsaved rows are discarded; user should call
  // window.alex2.dumpInputLog() first if they want to keep them).
  inputLogRows.length = 0;
  // Re-arm substep log (any unsaved rows are discarded; user should call
  // window.alex2.dumpSubstepLog() first if they want to keep them).
  substepLogRows.length = 0;
});
