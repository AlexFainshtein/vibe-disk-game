# CLAUDE-ALEX2.md

Alex2's variant of the Vibe Disk Game — a **rope/chain physics sandbox** in reduced (joint-angle) coordinates. Auto-loaded into context via the `@`-import in [CLAUDE.md](CLAUDE.md). Read [CLAUDE.md](CLAUDE.md) first for shared concepts (engine, playfield, render/input/controls).

Alex2 is the second of Alex's chain experiments. The first variant (see git history — branch `Alex2: new variant — Verlet rope sandbox with adaptive XPBD constraint solver`) used Verlet + position-based dynamics. This one explores the *Lagrangian / reduced-coordinate* approach instead: each rope is parameterized by its N−1 joint angles, distance constraints are exact by construction, and the equations of motion come from analytical mechanics rather than constraint projection.

## Entry page

- [alex2.html](Alex2/alex2.html) — sets `<body data-player="alex2">` so [main.js](main.js) dynamically imports `alex2-physics.js`. Single button in `#panel`: Reset. The disk and bar are deliberately disabled (`bar.hidden = true`, `inputHooks.diskGrab = false`, `setDiskRadiusFraction(0)`); the playfield exists only as a backdrop for the chain.

## What Alex2 is

Drag the small anchor dot to whip the chain around. The chain hangs from the anchor; all motion in the chain comes from anchor motion plus the chain's own dynamics (no gravity in this variant — that's an obvious add-on, deliberately left off so the dynamics tester sees only the spring/Coriolis/bending behavior).

Two chains are drawn one above the other by default (N=50, N=100), so the **N-dependence is visible directly** — same anchor input drives both, and a correct Lagrangian formulation should make the two chains move nearly identically. `SOLO_MODE = true` (current default) keeps only the N=100 chain for cleaner traces.

Input:
- **Mouse drag** on the anchor dot — smooth continuous driving.
- **Arrow keys** — bounded velocity impulse (`ANCHOR_KEY_VELOCITY_STEP` px/s per press) delivered as an instantaneous angular-momentum kick to the chain.

## Physics model

Each chain is parameterized by N−1 joint angles `θ_k` (one per segment). The state vector is `[θ, θ̇]`, total 2(N−1) components. Distance constraints are exact: every segment has length L, no stretching is possible by construction.

The Lagrangian equations of motion are
```
M(θ) · θ̈ + C(θ, θ̇) = Q_anchor + Q_bend + Q_damp
```

with
```
M_{jk}(θ) = L² · cos(θ_j − θ_k) · μ_{jk}            (mass matrix, dense, SPD)
C_j(θ, θ̇) = Σ_k L² · μ_{jk} · sin(θ_j − θ_k) · θ̇_k²  (Coriolis vector — see note below)
Q_anchor_j = L · μ_{jj} · (sin θ_j · ẍ_anchor − cos θ_j · ÿ_anchor)
μ_{jk}     = Σ_{i ≥ max(j,k)} m_i                   (lumped mass; uniform → (Ns − max(j,k))·m)
```

**Bending** is **nonlinear**, designed so that adjacent segments cannot fold onto each other. The per-pair potential is
```
V_pair(Δθ) = −4 · k_θ · log(cos(Δθ/2)),     k_θ = BENDING_EI / L
```
giving `V'(Δθ) = 2·k_θ·tan(Δθ/2)`. The small-Δθ limit (`tan(Δθ/2) ≈ Δθ/2`) recovers the linear angular spring `V'(Δθ) ≈ k_θ·Δθ` — so `BENDING_EI` keeps tuning the same "soft-regime stiffness" it did before. As |Δθ| → π the restoring torque diverges, preventing fold-over. A small ε-clamp keeps `|Δθ|` away from the `tan` singularity.

The generalized bending force on θ_j is `V'(θ_{j+1} − θ_j) − V'(θ_j − θ_{j−1})` (free-end Neumann BCs).

**Strain-rate damping** is the linear discrete Laplacian on θ̇ (same Neumann BCs): pulls each joint's angular velocity toward its neighbors'. Zero effect on rigid rotation (all θ̇ equal → Laplacian = 0), suppresses high-frequency / alternating-sign modes exponentially. Coefficient `DAMPING_BEND`.

**Mass damping** subtracts `DAMPING_MASS · θ̇` from θ̈ each frame — slowly bleeds off bulk rotation. Set to 0 to coast indefinitely.

### Naming note: Coriolis vs centrifugal

We call the `C` vector "Coriolis" in the code, following the robotics/multibody-dynamics convention where the lumped `C(q,q̇)·q̇` vector is named that way. **Physically the term is centrifugal**, not Coriolis: it is quadratic in a *single* angular velocity at each k (`θ̇_k²`), and Coriolis forces are bilinear in *two distinct* velocities. The actual Coriolis-character coupling in this system lives in the cross term of the kinetic energy (`m·ȧ_anchor · L·R(θ_k)·θ̇_k`, bilinear in anchor velocity and segment angular velocity), where the anchor-velocity × segment-rotation pairing has the textbook Coriolis structure. In the 2D pure-translation case, the Euler-Lagrange algebra collapses that cross term into the `Q_anchor` acceleration coupling we have, so no explicit anchor-velocity term appears in the EOM — the Coriolis character is structural (which variables couple), not necessarily a separate surviving term. **Code keeps the conventional name; this note records the physical reading.**

## Integration

Explicit RK4 on the first-order system `y' = f(y)`, `y = [θ, θ̇]`. Each RK4 evaluation does:
1. Build M, C, Q at the current state (O(N²) for M and C).
2. Solve `M · θ̈ = Q − C` via dense Gaussian elimination with partial pivoting (O(N³)).

That's 4 builds + 4 solves per RK4 step. At N=100 this is ~4M ops per step; fits comfortably in a frame.

**Internal substepping** (`RK4_SUBSTEPS_PER_FRAME = 16`): each real frame, the integrator does N small RK4 steps of size `h/N`. Why per-frame substepping instead of `SLOWDOWN > 1`: slowdown would advance chain time at `h/SLOWDOWN` but leave the anchor running at the wall-clock rate, producing an anchor-vs-chain time mismatch (chain reacts slowly, anchor moves fast in physics terms). Substepping refines the chain integration without changing the chain's total physics time per real frame, so the anchor stays in lockstep.

Refining h is the **B2** robustness lever: smaller h reduces RK4's substep-amplification of the nonlinear Coriolis term, raising the |θ̇| threshold at which the integrator blows up.

### Smooth anchor delivery

Mouse-drag velocity changes are converted to a smooth anchor acceleration:
```
ax = Δv_x / h,   ay = Δv_y / h
```
which is passed to `Q_anchor` during the RK4 evaluations (constant across the N internal substeps within one real frame). This delivers the same total angular-momentum impulse but spreads it across the chain's integration, so the quadratic Coriolis term doesn't see a Δv-induced velocity jump at every substep. Without this smoothing, mouse impulses caused the chain to explode much more easily.

Arrow-key kicks bypass this entirely: they apply an exact angular-momentum impulse `M · Δθ̇ = L · μ_{jj} · (sin θ_j · Δv_x − cos θ_j · Δv_y)` directly inside the keydown handler. Cheap and stable.

## Tunables (top of [alex2-physics.js](Alex2/alex2-physics.js))

| Constant | Default | Role |
|---|---|---|
| `N1`, `N2` | 50, 100 | Two side-by-side chain sizes for the comparison view |
| `ROPE_LENGTH_FRACTION` | 0.45 | Each chain's total length as a fraction of canvas width |
| `M_ROPE` | 1 | Total mass of one chain (excluding anchor) |
| `SLOWDOWN` | 1 | Visible-motion slowdown (keep at 1 with mouse drag — see note above) |
| `RK4_SUBSTEPS_PER_FRAME` | 16 | Internal RK4 substeps per real frame (the B2 robustness lever) |
| `ANCHOR_KEY_VELOCITY_STEP` | 50 px/s | Arrow-key impulse magnitude |
| `BENDING_EI` | 100 | Continuum flexural rigidity; `k_θ = BENDING_EI / L` |
| `DAMPING_BEND` | 1 | Strain-rate (discrete Laplacian on θ̇) damping coefficient |
| `DAMPING_MASS` | 0.1 | Mass-proportional damping coefficient |
| `SOLO_MODE` | true | Keep only one chain (clean traces); false = comparison view |
| `SOLO_N` | N2 | Which chain size to keep in solo mode |

### Diagnostic flags (all currently false; flip individually to investigate)

| Flag | What it logs |
|---|---|
| `ENERGY_MONITOR` | E = ½ θ̇ᵀ M θ̇ per frame; spike/NaN warnings when E_new / E_prev > `E_SPIKE_RATIO` |
| `TRACE_ENABLED` | Per-frame θ_j values (head + tail) for `TRACE_DURATION_FRAMES`; stops on NaN |
| `CONDITION_ESTIMATE` | Spectral κ₂(M) via power iteration (λ_max) + inverse power iteration (λ_min). Confirmed M conditioning is **not** the cause of explosions — κ stayed ~1.5e4 throughout failures |
| `SUBSTEP_LOG_ENABLED` | Per-substep RHS and θ̈ for the first `SUBSTEP_LOG_HEAD` joints, every RK4 substep. Used to confirm RK4's intermediate-substep amplification of nonlinear Coriolis growth |
| `INPUT_LOG_ENABLED` | Per-frame anchor position / velocity / acceleration in px-per-frame units (same scale as L ≈ 4 px), gated alongside the trace so frame indices align with the substep log |

All diagnostic outputs go to the console; substep log dumps to a CSV when tracing stops.

## Known limitations

- **RK4 sensitivity to θ̈·h²** — the failure mode is not linear instability but nonlinear: inside one RK4 step, the four k_i evaluations each see the previous one's overshoot, and once θ̈·h² becomes comparable to a characteristic angle, the four k_i diverge geometrically within a single step. `RK4_SUBSTEPS_PER_FRAME = 16` raises the threshold significantly but hard mouse drags can still crash the chain (NaN).
- **Tiny knots under fast rotation** — when the chain is spinning, the (centrifugal-character) `C` term creates strong stress along the chain, which the nonlinear bending balances at a small but visible Δθ. The result reads as a tiny "knot" or pinch-point on the otherwise smooth curve. They're stable while rotation continues and unwind on release. Visible but cosmetic.
- **No gravity / no friction / no collisions** — by design. The point is to stress-test the integrator and bending, not to build a complete sandbox.

## Future directions

- **B3 (implicit midpoint / Newmark)** — the promising next step for stability. Implicit methods are A-stable: the next state is solved self-consistently with the *next-state* forces, breaking the RK4 substep-amplification loop. Cost is a Newton iteration per step (2–4 iters, each one linear solve), so ~3–4× the per-step cost, but with stable h values 10–100× larger. Discussed but not implemented.
- **B4 (symplectic Verlet / Yoshida)** — fundamentally still explicit, same θ̈·h² sensitivity as RK4. Wins long-term energy preservation, not robustness to stiff spikes. Not promising for this problem on its own; the cloth/rope-sim trick is Verlet + iterative constraint projection (Jakobsen), which is a separate technique.

## Sizing

Chain length is `canvas.width * ROPE_LENGTH_FRACTION`; segment length `L = (canvas.width · ROPE_LENGTH_FRACTION) / (N − 1)`. Anchor marker radius `ANCHOR_MARKER_RADIUS_FRAC` (visible dot) and grab radius `ANCHOR_GRAB_RADIUS_FRAC` (touch target) are fractions of the canvas dimension.

## Reset behavior

The Reset button (handler in [controls.js](controls.js)) resets the anchor to its initial position and zeros all `θ` and `θ̇`. Tracing/logging buffers also restart so a Reset gives clean repeatable runs.
