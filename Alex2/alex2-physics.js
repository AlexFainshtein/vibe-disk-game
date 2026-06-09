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

bar.hidden = true;
inputHooks.diskGrab = false;
setDiskRadiusFraction(0);

const N = 100;
const ROPE_LENGTH_FRACTION = 0.45;

// Total chain mass (excluding anchor). Distributed uniformly across the
// N−1 non-anchor particles. Combined with the Lagrangian formulation,
// dynamics should be approximately N-invariant.
const M_ROPE = 1;

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
const BENDING_EI = 1;

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
const DAMPING_BEND = 1000;

// DAMPING_MASS: mass-proportional damping. Subtracts α · θ̇ from θ̈ each
// frame, so the time constant of every mode decays at rate α regardless of
// frequency. Use to slowly bleed off rotation / bulk motion. 0 means the
// chain coasts indefinitely (only DAMPING_BEND dissipates).
const DAMPING_MASS = 0.1; // was 0

// --- Implicit integrators (experimental, B3 in our discussion) --------
//
// INTEGRATOR: 'rk4' (explicit, the old default), 'implicit-midpoint'
// (A-stable; conserves high-frequency modes — vulnerable to feedback
// chaos in stiff regimes), or 'implicit-euler' (L-stable; damps
// high-frequency modes, more robust to stiffness at the price of
// slight artificial damping).  Both implicit variants share the same
// per-substep Newton iteration; only the residual definition and the
// Jacobian's h-coefficient differ.
const INTEGRATOR                     = 'implicit-midpoint';
const IMPLICIT_SUBSTEPS_PER_FRAME    = 32; // 16 is not robust enough for N=100 at BENDING_EI=1; 32 is, with some room to spare. 64 is overkill.
const NEWTON_MAX_ITERS               = 8;
// Warm-start: seed each substep's Newton iteration from the previous
// substep's realized increment (linear extrapolation y⁰ = yₙ + Δy_prev)
// instead of one explicit-Euler step (y⁰ = yₙ + h·f(yₙ)).  The realized
// increment is bounded physical motion, so it avoids the h·θ̈ overshoot
// that walks the explicit-Euler guess out of Newton's convergence basin
// once θ̈ gets large.  Falls back to explicit Euler when no prior
// increment is available (first substep after Reset / impulse / a
// non-converged step).  Toggle false to compare against the cold-start.
const NEWTON_WARM_START              = true;
// Newton convergence: stop when ‖Δy‖ / max(‖y‖, 1) < NEWTON_TOL.
const NEWTON_TOL                     = 1e-6;
// Diagnostic: when true, log a one-line summary per frame showing how
// each substep's Newton iteration went.
const NEWTON_LOG_ENABLED             = true;

// --- Energy monitoring (diagnostic) ------------------------------------
//
// Compute E = (1/2) θ̇ᵀ M(θ) θ̇ per rope per frame. For the conservative
// system this is exactly conserved (Noether); with damping it must
// monotonically decrease. Anything else — sudden spikes, NaN, runaway
// growth — is a numerical-stability problem we want to catch in the act.
const ENERGY_MONITOR  = true;     // off — no console spam during this test
const E_SPIKE_RATIO   = 100;       // log when E_new / E_prev exceeds this

// --- Trace mode (diagnostic) ------------------------------------------
//
// TRACE_ENABLED + TRACE_DURATION_FRAMES: log θ_j every frame for the first
// N frames after page load / Reset.  Stops automatically on NaN.
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

// THETA_LOG: per-frame samples of θ_i at three fixed joint indices
// (left / middle / right of chain).  Recording starts on the first
// anchor interaction; dump via window.alex2.dumpThetaLog().  Defaults
// are for N=14 (Ns=13).  Edit THETA_LOG_I_* if Ns differs.
const THETA_LOG_ENABLED         = false;
const THETA_LOG_I_LEFT          = 1;
const THETA_LOG_I_MID           = 6;
const THETA_LOG_I_RIGHT         = 11;

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
    // --- Implicit-midpoint scratch ---
    // A_raw, B_raw: M·(∂θ̈/∂θ) and M·(∂θ̈/∂θ̇) respectively, assembled at
    // the midpoint state.  K = M − (h/2)·B_raw − (h²/4)·A_raw — the reduced
    // Ns×Ns matrix whose LU we solve for Δθ each Newton iteration.
    A_raw:            new Float64Array(Ns * Ns),
    B_raw:            new Float64Array(Ns * Ns),
    K:                new Float64Array(Ns * Ns),
    M_snap:           new Float64Array(Ns * Ns),  // pristine M survives the Newton-iter linear solves
    // State buffers across one implicit step.
    thetaN:           new Float64Array(Ns),       // θ at start of step (y_n)
    thetaDotN:        new Float64Array(Ns),       // θ̇ at start of step
    thetaNew:         new Float64Array(Ns),       // current iterate of y_{n+1}
    thetaDotNew:      new Float64Array(Ns),
    thetaMid:         new Float64Array(Ns),       // (y_n + y_{n+1})/2
    thetaDotMid:      new Float64Array(Ns),
    ddtMid:           new Float64Array(Ns),       // θ̈ at midpoint (M·ddt = b_full)
    F_theta:          new Float64Array(Ns),       // residual top half
    F_thetaDot:       new Float64Array(Ns),       // residual bottom half
    dTheta:           new Float64Array(Ns),       // Newton update for θ
    dThetaDot:        new Float64Array(Ns),       // Newton update for θ̇
    Krhs:             new Float64Array(Ns),       // RHS of the K·Δθ = … solve
    tmpNs:            new Float64Array(Ns),       // general scratch
    tmpNs2:           new Float64Array(Ns),       // general scratch
    // Warm-start: realized increment (Δθ, Δθ̇) of the previous converged
    // substep, used as the next substep's Newton initial guess.  Valid only
    // after a converged step; invalidated on Reset / impulse.
    prevDTheta:       new Float64Array(Ns),
    prevDThetaDot:    new Float64Array(Ns),
    warmStartValid:   false,
    // Newton-iteration diagnostics, written by implicitMidpointStep and
    // read by update() when NEWTON_LOG_ENABLED.
    lastNewtonIters:    0,
    lastNewtonRelStep:  0,
    lastNewtonConverged: true,
  };
}

const ropes = [makeRope(N, canvas.width / 2, canvas.height * 0.5)];

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

// Dump the per-frame θ log accumulated in thetaLogRows.  Each row is
// [frame, t_seconds, theta_left, theta_mid, theta_right] capturing θ_i
// at the three configured joint indices.  Gated by THETA_LOG_ENABLED.
function dumpThetaLog(reason = 'manual'){
  if(typeof window === 'undefined' || typeof document === 'undefined') return;
  if(thetaLogRows.length === 0){
    console.log('[theta] no rows to dump');
    return;
  }
  const header = `frame,t_sec,theta_i${THETA_LOG_I_LEFT},theta_i${THETA_LOG_I_MID},theta_i${THETA_LOG_I_RIGHT}\n`;
  const body = thetaLogRows.map(r =>
    r.map((v, i) => i === 0 ? String(v) : (Number.isFinite(v) ? v.toFixed(6) : String(v))).join(',')
  ).join('\n');
  const csv = header + body + '\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href     = url;
  a.download = `alex2-theta-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  console.log(`[theta] dumped ${thetaLogRows.length} rows to CSV (reason: ${reason})`);
}

// Dump the current θ and θ̇ of all joints (rope 0) to BOTH a CSV file
// (spreadsheet-friendly) and a JSON file (full numerical precision for
// copy-paste back into chat).  Optional `label` becomes part of each
// filename so before/after snapshots can be told apart.
function dumpFullState(label = 'state'){
  if(typeof window === 'undefined' || typeof document === 'undefined') return;
  const rope = ropes[0];
  const Ns = rope.Ns;
  const ts = Date.now();

  // CSV form
  let csv = 'joint_index,theta,theta_dot\n';
  for(let i = 0; i < Ns; i++){
    const t  = rope.theta[i];
    const td = rope.thetaDot[i];
    const tStr  = Number.isFinite(t)  ? t.toExponential(15)  : String(t);
    const tdStr = Number.isFinite(td) ? td.toExponential(15) : String(td);
    csv += `${i},${tStr},${tdStr}\n`;
  }
  triggerDownload(csv, `alex2-state-${label}-${ts}.csv`, 'text/csv');

  // JSON form — full double precision via Array.from + JSON.stringify
  const json = JSON.stringify({
    label,
    timestamp: ts,
    Ns,
    theta:    Array.from(rope.theta),
    thetaDot: Array.from(rope.thetaDot),
  }, null, 2);
  triggerDownload(json, `alex2-state-${label}-${ts}.json`, 'application/json');

  console.log(`[state] dumped ${Ns} joints (${label}) — CSV + JSON`);
}

// Helper for the dump functions: trigger a browser download of `content`
// with the given filename and MIME type.
function triggerDownload(content, filename, mimeType){
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Expose ropes on window for console-side inspection during debugging:
// `alex2.ropes[0].theta`, etc.  Also exposes dumpInputLog() for manual
// CSV download.
if(typeof window !== 'undefined') window.alex2 = { ropes, dumpInputLog, dumpSubstepLog, dumpThetaLog, dumpFullState };

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

// Delta log: per-frame samples of Δθ at three fixed joint indices.
// Recording starts on first anchor interaction; one row per frame.
// Dumped on demand via window.alex2.dumpDeltaLog().
const thetaLogRows     = [];   // each row: [frame, t_sec, theta_left, theta_mid, theta_right]
let   thetaLogFrameCount = 0;
let   thetaLogTimeSec    = 0;  // cumulative wall-clock time since logging started

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
    // Linear bending — discrete Laplacian of θ scaled by k_θ, Neumann
    // (free-end) BCs.  The previous tan(Δθ/2) anti-folding model was
    // physically wrong (periodic in Δθ, can flip the bending sign and
    // create a runaway under sustained forcing).  Linear bending grows
    // monotonically with |Δθ| → always restoring → robust under any
    // forcing, at the cost of allowing the rope to wind into loops.
    let qBend = 0;
    if(Ns >= 2 && BENDING_EI !== 0){
      let lapTheta;
      if(j === 0){
        lapTheta = theta[1] - theta[0];
      } else if(j === Ns - 1){
        lapTheta = theta[Ns - 2] - theta[Ns - 1];
      } else {
        lapTheta = theta[j - 1] - 2 * theta[j] + theta[j + 1];
      }
      qBend = kTheta * lapTheta;
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
    // θ̇ just jumped discontinuously — the prior substep's increment no longer
    // predicts the next one, so cold-start the next Newton solve.
    rope.warmStartValid = false;
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

// --- Implicit-midpoint integrator (B3) --------------------------------

// Assembles A_raw = M·(∂θ̈/∂θ) and B_raw = M·(∂θ̈/∂θ̇) at the state
// (theta, thetaDot) with the midpoint acceleration ddt already computed.
// Reads rope.M_snap as the pristine M(theta); writes rope.A_raw, rope.B_raw.
//
// Mass damping is folded in by treating the EOM RHS as
//   b_full = Q_anchor − C + q_bend + q_strain − α · M · θ̇,
// so M · θ̈ = b_full.  The −α·M·θ̇ piece adds −α·(∂M/∂θ_k)·θ̇ to ∂b/∂θ
// and −α·M to ∂b/∂θ̇.  Both fold into the formulas below.
function buildJacobianBlocks(rope, theta, thetaDot, ddt, ax, ay){
  const Ns         = rope.Ns;
  const L          = rope.segmentLength;
  const m          = rope.particleMass;
  const muDiag     = rope.muDiag;
  const L2         = L * L;
  const kTheta     = BENDING_EI / L;
  const A          = rope.A_raw;
  const B          = rope.B_raw;
  const M          = rope.M_snap;
  const w          = rope.tmpNs;
  const S          = rope.tmpNs2;

  A.fill(0);
  B.fill(0);

  // w_j := α·θ̇_j + ddt_j — single vector to contract with (∂M/∂θ_k),
  // capturing both the −(∂M/∂θ_k)·ddt term in the A_raw formula and the
  // −α·(∂M/∂θ_k)·θ̇ piece coming from differentiating −α·M·θ̇ in b_full.
  for(let i = 0; i < Ns; i++) w[i] = DAMPING_MASS * thetaDot[i] + ddt[i];

  // S_i := Σ_j L²·μ_{ij}·sin(θ_i − θ_j)·w_j — used on the i==k diagonal
  // of the M-derivative contribution to A_raw.
  for(let i = 0; i < Ns; i++){
    let s = 0;
    for(let j = 0; j < Ns; j++){
      const mu = (Ns - Math.max(i, j)) * m;
      s += L2 * mu * Math.sin(theta[i] - theta[j]) * w[j];
    }
    S[i] = s;
  }

  // --- A_raw assembly, column by column ---
  for(let k = 0; k < Ns; k++){
    const tdk2 = thetaDot[k] * thetaDot[k];

    // ∂Q_anchor/∂θ_k = δ · L · μ_kk · (cos θ_k · ax + sin θ_k · ay) (diagonal)
    A[k * Ns + k] += L * muDiag[k] * (Math.cos(theta[k]) * ax + Math.sin(theta[k]) * ay);

    // −∂C_i/∂θ_k: off-diagonal piece +L²·μ_ik·cos(θ_i−θ_k)·θ̇_k² for all i,
    // plus a diagonal correction −Σ_l L²·μ_kl·cos(θ_k−θ_l)·θ̇_l² at i = k.
    for(let i = 0; i < Ns; i++){
      const muIK = (Ns - Math.max(i, k)) * m;
      A[i * Ns + k] += L2 * muIK * Math.cos(theta[i] - theta[k]) * tdk2;
    }
    let sumC = 0;
    for(let l = 0; l < Ns; l++){
      const muKL = (Ns - Math.max(k, l)) * m;
      sumC += L2 * muKL * Math.cos(theta[k] - theta[l]) * thetaDot[l] * thetaDot[l];
    }
    A[k * Ns + k] -= sumC;

    // −(∂M/∂θ_k)·w contribution.  (∂M/∂θ_k)_ij = L²·μ_ij·sin(θ_i−θ_j)·(δ_kj − δ_ki).
    // → row i: −L²·μ_ik·sin(θ_i−θ_k)·w_k for all i (vanishes at i=k since sin 0 = 0)
    //   plus +S_k at i = k (the δ_ki piece).
    for(let i = 0; i < Ns; i++){
      const muIK = (Ns - Math.max(i, k)) * m;
      A[i * Ns + k] -= L2 * muIK * Math.sin(theta[i] - theta[k]) * w[k];
    }
    A[k * Ns + k] += S[k];
  }

  // Linear bending: tridiagonal contribution to A_raw with constant
  // weight V''(Δθ) = kTheta.  Neumann BCs (free ends).
  if(BENDING_EI !== 0 && Ns >= 2){
    for(let i = 0; i < Ns; i++){
      if(i < Ns - 1){
        A[i * Ns + i]       -= kTheta;
        A[i * Ns + (i + 1)] += kTheta;
      }
      if(i > 0){
        A[i * Ns + i]       -= kTheta;
        A[i * Ns + (i - 1)] += kTheta;
      }
    }
  }

  // --- B_raw assembly ---
  // Dense parts: −∂C/∂θ̇_m and −α·M.
  for(let j = 0; j < Ns; j++){
    for(let mm = 0; mm < Ns; mm++){
      const muJM = (Ns - Math.max(j, mm)) * m;
      B[j * Ns + mm] -= 2 * L2 * muJM * Math.sin(theta[j] - theta[mm]) * thetaDot[mm];
      B[j * Ns + mm] -= DAMPING_MASS * M[j * Ns + mm];
    }
  }

  // Strain-rate damping: tridiagonal contribution (Neumann BCs).
  if(DAMPING_BEND !== 0 && Ns >= 2){
    const c = DAMPING_BEND;
    B[0 * Ns + 0] -= c;
    B[0 * Ns + 1] += c;
    for(let j = 1; j < Ns - 1; j++){
      B[j * Ns + (j - 1)] += c;
      B[j * Ns + j]       -= 2 * c;
      B[j * Ns + (j + 1)] += c;
    }
    B[(Ns - 1) * Ns + (Ns - 2)] += c;
    B[(Ns - 1) * Ns + (Ns - 1)] -= c;
  }
}

// One implicit step advancing (θ, θ̇) by h, parametrized by gamma:
//   gamma = 0.5  → implicit midpoint: f evaluated at (y_n + y_new)/2,
//                  Jacobian coefficient h·gamma = h/2; A-stable but not
//                  L-stable (high-freq modes survive with bounded amplitude).
//   gamma = 1.0  → implicit Euler:    f evaluated at y_new, Jacobian
//                  coefficient h·gamma = h; both A- and L-stable
//                  (high-freq modes damped per step).
// In both cases Newton solves F(y_new) = 0 where
//   F(y_new) = y_new − y_n − h · f(y_n + gamma·(y_new − y_n))
// and the block-eliminated linear system is
//   K · Δθ = M·r_θ + h·gamma·M·r_θ̇ − h·gamma·B_raw·r_θ
// with K = M − h·gamma·B_raw − (h·gamma)²·A_raw.  Δθ̇ recovered from row 1
// as Δθ̇ = (1/(h·gamma))·(Δθ − r_θ).
// Returns true if Newton converged to NEWTON_TOL, false if it bailed at
// NEWTON_MAX_ITERS.  Anchor acceleration (ax, ay) held constant.
function implicitStep(rope, h, ax, ay, gamma){
  const Ns          = rope.Ns;
  const theta       = rope.theta;
  const thetaDot    = rope.thetaDot;
  const thetaN      = rope.thetaN;
  const thetaDotN   = rope.thetaDotN;
  const thetaNew    = rope.thetaNew;
  const thetaDotNew = rope.thetaDotNew;
  const thetaEval   = rope.thetaMid;       // f-evaluation point: y_n + gamma·(y_new − y_n)
  const thetaDotEval= rope.thetaDotMid;
  const ddtEval     = rope.ddtMid;
  const F_theta     = rope.F_theta;
  const F_thetaDot  = rope.F_thetaDot;
  const dTheta      = rope.dTheta;
  const dThetaDot   = rope.dThetaDot;
  const A           = rope.A_raw;
  const B           = rope.B_raw;
  const K           = rope.K;
  const Krhs        = rope.Krhs;
  const Msnap       = rope.M_snap;
  // r_θ = −F_theta, r_θ̇ = −F_thetaDot — read off F_* with negation at the
  // use site to save scratch (rope.tmpNs / tmpNs2 are aliased inside
  // buildJacobianBlocks, so we can't stage them there).

  _solveMinPivot = Infinity;
  _solveMaxPivot = 0;

  thetaN.set(theta);
  thetaDotN.set(thetaDot);

  // Initial guess for the Newton iterate y_{n+1}^(0).
  if(NEWTON_WARM_START && rope.warmStartValid){
    // Warm start: linear extrapolation from the previous converged substep's
    // realized increment, y⁰ = y_n + Δy_prev.  Bounded physical motion, so it
    // can't overshoot Newton's basin the way h·θ̈ can; also skips the
    // explicit-Euler build+solve entirely (one fewer O(N³) solve per substep).
    const prevDTheta    = rope.prevDTheta;
    const prevDThetaDot = rope.prevDThetaDot;
    for(let i = 0; i < Ns; i++){
      thetaNew[i]    = thetaN[i]    + prevDTheta[i];
      thetaDotNew[i] = thetaDotN[i] + prevDThetaDot[i];
    }
  } else {
    // Cold start: one explicit-Euler step, y⁰ = y_n + h·f(y_n).  Used on the
    // first substep after Reset / impulse / a non-converged step.  We fold
    // mass damping into b_full here for consistency with the Newton loop.
    buildMassMatrix(rope, thetaN);
    Msnap.set(rope.M);
    buildRhs(rope, thetaN, thetaDotN, ax, ay);
    if(DAMPING_MASS !== 0){
      for(let i = 0; i < Ns; i++){
        let s = 0;
        for(let j = 0; j < Ns; j++) s += Msnap[i * Ns + j] * thetaDotN[j];
        rope.rhs[i] -= DAMPING_MASS * s;
      }
    }
    solveLinear(rope);
    for(let i = 0; i < Ns; i++){
      thetaNew[i]    = thetaN[i]    + h * thetaDotN[i];
      thetaDotNew[i] = thetaDotN[i] + h * rope.accel[i];
    }
  }

  const oneMinusGamma = 1 - gamma;
  const hg            = h * gamma;
  const hg2           = hg * hg;
  const invHg         = 1 / hg;

  let converged = false;
  let iters     = 0;
  let lastRel   = 0;
  for(let iter = 0; iter < NEWTON_MAX_ITERS; iter++){
    iters = iter + 1;
    // f-evaluation point: y_eval = (1 − γ)·y_n + γ·y_new.
    for(let i = 0; i < Ns; i++){
      thetaEval[i]    = oneMinusGamma * thetaN[i]    + gamma * thetaNew[i];
      thetaDotEval[i] = oneMinusGamma * thetaDotN[i] + gamma * thetaDotNew[i];
    }

    // Build M(eval), snapshot, then b_full, then solve for ddt_eval.
    buildMassMatrix(rope, thetaEval);
    Msnap.set(rope.M);
    buildRhs(rope, thetaEval, thetaDotEval, ax, ay);
    if(DAMPING_MASS !== 0){
      for(let i = 0; i < Ns; i++){
        let s = 0;
        for(let j = 0; j < Ns; j++) s += Msnap[i * Ns + j] * thetaDotEval[j];
        rope.rhs[i] -= DAMPING_MASS * s;
      }
    }
    solveLinear(rope);
    ddtEval.set(rope.accel);

    // Residual F(y_new) = y_new − y_n − h · f(y_eval).
    for(let i = 0; i < Ns; i++){
      F_theta[i]    = thetaNew[i]    - thetaN[i]    - h * thetaDotEval[i];
      F_thetaDot[i] = thetaDotNew[i] - thetaDotN[i] - h * ddtEval[i];
    }

    // Jacobian blocks at the eval state.  Clobbers rope.tmpNs / tmpNs2.
    buildJacobianBlocks(rope, thetaEval, thetaDotEval, ddtEval, ax, ay);

    // K = M − hγ·B_raw − (hγ)²·A_raw.
    const Ns2 = Ns * Ns;
    for(let i = 0; i < Ns2; i++){
      K[i] = Msnap[i] - hg * B[i] - hg2 * A[i];
    }

    // Krhs = M·r_θ + hγ·M·r_θ̇ − hγ·B·r_θ, with r = −F.
    for(let i = 0; i < Ns; i++){
      let mTheta = 0, mThetaDot = 0, bTheta = 0;
      for(let j = 0; j < Ns; j++){
        mTheta    += Msnap[i * Ns + j] * (-F_theta[j]);
        mThetaDot += Msnap[i * Ns + j] * (-F_thetaDot[j]);
        bTheta    += B[i * Ns + j]     * (-F_theta[j]);
      }
      Krhs[i] = mTheta + hg * mThetaDot - hg * bTheta;
    }

    // Solve K·Δθ = Krhs.
    gaussSolve(Ns, K, Krhs, dTheta);

    // Recover Δθ̇ = (1/(hγ))·(Δθ + F_theta).
    let dNorm2 = 0, yNorm2 = 0;
    for(let i = 0; i < Ns; i++){
      dThetaDot[i]    = invHg * (dTheta[i] + F_theta[i]);
      thetaNew[i]    += dTheta[i];
      thetaDotNew[i] += dThetaDot[i];
      dNorm2 += dTheta[i] * dTheta[i] + dThetaDot[i] * dThetaDot[i];
      yNorm2 += thetaNew[i] * thetaNew[i] + thetaDotNew[i] * thetaDotNew[i];
    }
    const denom = Math.max(Math.sqrt(yNorm2), 1);
    lastRel = Math.sqrt(dNorm2) / denom;
    if(lastRel < NEWTON_TOL){ converged = true; break; }
  }

  // Record the realized increment as the next substep's warm-start seed —
  // but only if Newton converged, so we never extrapolate from garbage.
  if(converged){
    const prevDTheta    = rope.prevDTheta;
    const prevDThetaDot = rope.prevDThetaDot;
    for(let i = 0; i < Ns; i++){
      prevDTheta[i]    = thetaNew[i]    - thetaN[i];
      prevDThetaDot[i] = thetaDotNew[i] - thetaDotN[i];
    }
    rope.warmStartValid = true;
  } else {
    rope.warmStartValid = false;
  }

  theta.set(thetaNew);
  thetaDot.set(thetaDotNew);

  rope.pivotMin            = _solveMinPivot;
  rope.pivotMax            = _solveMaxPivot;
  rope.pivotRatio          = _solveMaxPivot > 0 ? _solveMinPivot / _solveMaxPivot : 0;
  rope.lastNewtonIters     = iters;
  rope.lastNewtonRelStep   = lastRel;
  rope.lastNewtonConverged = converged;

  return converged;
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
  const h = dt;
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

  // Per real frame, take SUBSTEPS_PER_FRAME steps of the active integrator
  // (RK4 or implicit midpoint).  Anchor acceleration (ax, ay) is held
  // constant across substeps — the chain receives the same total impulse
  // it would have with a single h-step.
  // gamma encodes which implicit method we're running:
  // 0.5 → midpoint, 1.0 → Euler.  null means RK4 (no Newton iteration).
  const gamma    = INTEGRATOR === 'implicit-midpoint' ? 0.5
                 : INTEGRATOR === 'implicit-euler'    ? 1.0
                 : null;
  const isImplicit = gamma !== null;
  const substeps = isImplicit ? IMPLICIT_SUBSTEPS_PER_FRAME : RK4_SUBSTEPS_PER_FRAME;
  const h_sub    = h / substeps;
  // Per-frame Newton log, only used when NEWTON_LOG_ENABLED.  Captures
  // (iters, relStep, converged) for every substep across every rope so we
  // can spot Newton failures or near-failures.
  const newtonItersArr   = NEWTON_LOG_ENABLED ? new Array(substeps) : null;
  const newtonRelArr     = NEWTON_LOG_ENABLED ? new Array(substeps) : null;
  let   newtonConvCount  = 0;
  for(const rope of ropes){
    for(let s = 0; s < substeps; s++){
      if(isImplicit){
        implicitStep(rope, h_sub, ax, ay, gamma);
        if(NEWTON_LOG_ENABLED){
          newtonItersArr[s] = rope.lastNewtonIters;
          newtonRelArr[s]   = rope.lastNewtonRelStep;
          if(rope.lastNewtonConverged) newtonConvCount++;
        }
      } else {
        rk4Step(rope, h_sub, ax, ay);
      }
    }
    if(NEWTON_LOG_ENABLED && isImplicit && anchorHasInteracted){
      // Only print problem frames: a substep failed to converge, or one
      // strained close to the iteration cap (run-up to a failure).  Healthy
      // frames (all converged in few iters) stay silent so the failure
      // moment isn't buried under thousands of identical lines.
      const maxIters = newtonItersArr.reduce((a, b) => Math.max(a, b ?? 0), 0);
      const NEWTON_NEAR_FAIL_ITERS = NEWTON_MAX_ITERS - 2;   // 6 of 8 = straining
      if(newtonConvCount < substeps || maxIters >= NEWTON_NEAR_FAIL_ITERS){
        const itersStr = newtonItersArr.join(',');
        const relStr   = newtonRelArr.map(r => Number.isFinite(r) ? r.toExponential(2) : String(r)).join(',');
        console.log(`[Newton N=${rope.N}] iters=[${itersStr}] relStep=[${relStr}] converged=${newtonConvCount}/${substeps} (${INTEGRATOR})`);
      }
      newtonConvCount = 0;
    }
    // Per-frame θ samples at three fixed joint indices.  Recording starts
    // on first anchor interaction so frame 0 isn't a flood of all-zero rows.
    if(THETA_LOG_ENABLED && anchorHasInteracted && rope === ropes[0]){
      const Ns = rope.Ns;
      const iL = THETA_LOG_I_LEFT, iM = THETA_LOG_I_MID, iR = THETA_LOG_I_RIGHT;
      if(iL < Ns && iM < Ns && iR < Ns){
        thetaLogTimeSec += h;
        thetaLogRows.push([
          thetaLogFrameCount,
          thetaLogTimeSec,
          rope.theta[iL],
          rope.theta[iM],
          rope.theta[iR],
        ]);
        thetaLogFrameCount++;
      }
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
    rope.warmStartValid = false;
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
  // Re-arm θ log (any unsaved rows are discarded; user should call
  // window.alex2.dumpThetaLog() first if they want to keep them).
  thetaLogRows.length = 0;
  thetaLogFrameCount  = 0;
  thetaLogTimeSec     = 0;
});
