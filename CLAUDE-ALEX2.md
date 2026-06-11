# CLAUDE-ALEX2.md

Alex2's variant of the Vibe Disk Game — a **rope/chain physics sandbox** in reduced (joint-angle) coordinates. Auto-loaded into context via the `@`-import in [CLAUDE.md](CLAUDE.md). Read [CLAUDE.md](CLAUDE.md) first for shared concepts (engine, playfield, render/input/controls).

Alex2 is the second of Alex's chain experiments. The first variant (see git history — branch `Alex2: new variant — Verlet rope sandbox with adaptive XPBD constraint solver`) used Verlet + position-based dynamics. This one explores the *Lagrangian / reduced-coordinate* approach instead: each rope is parameterized by its N−1 joint angles, distance constraints are exact by construction, and the equations of motion come from analytical mechanics rather than constraint projection.

## Entry page

- [alex2.html](Alex2/alex2.html) — sets `<body data-player="alex2">` so [main.js](main.js) dynamically imports `alex2-physics.js`. Single button in `#panel`: Reset. The disk and bar are deliberately disabled (`bar.hidden = true`, `inputHooks.diskGrab = false`, `setDiskRadiusFraction(0)`); the playfield exists only as a backdrop for the chain.

## What Alex2 is

Grab the big **handle** and whip the chain around. The handle drives a **spring**, the spring drives the **anchor** (the chain head), and the chain hangs off the anchor under **gravity**. The chain starts hanging straight down; the handle starts above the anchor.

A single chain is drawn by default (`N = 50`; was 100 — see the perf note in Known limitations). The factory `makeRope` and the array-of-ropes structure are kept so the variant can be extended to a multi-rope comparison view (e.g. N=50 vs N=100, same anchor input) by pushing additional `makeRope(...)` calls into the `ropes` array — useful for verifying N-invariance after future integrator changes.

Input:
- **Mouse drag on the handle** — spring mode (the shipping control). The finger moves the handle; the anchor is a spring-mass-damper that chases it. The handle has **no L/R clamp** — drag it off one side and it wraps to the other; grab detection is wrap-aware so it's never lost. Released, the handle **stays where you left it** (it has no gravity — it's the control point). Vertically it's clamped on-screen (no vertical wrap).
- **Mouse drag on the small anchor dot** — direct mode (testing): the finger pins the anchor rigidly, bypassing the spring. This re-exposes the hard-jerk blow-up, so it's a test handle only, not for the end user.
- **Arrow keys** — bounded velocity impulse (`ANCHOR_KEY_VELOCITY_STEP` px/s per press) delivered as an instantaneous angular-momentum kick to the chain.

### Mouse→anchor spring, handle, gravity, wrap

- **Spring (low-pass on the forcing).** The anchor's acceleration fed to `Q_anchor` is the spring force / mass — `K·stretch`, a function of *displacement*, not `Δv/h`. So a fast jerk or a clamped (slow) frame can't manufacture a huge `ax` the way the old finger-pinned anchor could. This is what turned the irrecoverable hard-jerk NaN into a *recoverable* transient (a brief Newton-struggle / fps dip that self-heals). Constants: `SPRING_K`, `SPRING_DAMP`, `ANCHOR_MASS`, `SPRING_REST_FRAC`. Direct anchor mode keeps the old `ax = Δv/h` path for testing.
- **Gravity** (`GRAVITY`, px/s²; 0 disables). Acts on the chain as a generalized force `Q_grav_j = g·L·μ_jj·cos θ_j` (so θ=π/2 / straight-down is the equilibrium) and on the anchor body (`ay += g`). It does **not** act on the spring or handle (kinematic control elements). Added to `buildRhs` *and* its θ-derivative to the Newton Jacobian in `buildJacobianBlocks`, so the implicit solve stays consistent. Equivalence-principle-consistent: if the anchor free-falls, `Q_anchor`'s `−cos θ_j·ay` cancels `Q_grav`, so a free-falling chain doesn't spuriously deform.
- **Toroidal wrap — horizontal only** (`USE_CHAIN_WRAP`). The whole movable scene (chain + spring + anchor dot + handle) is drawn once per needed canvas shift via `ctx.translate`, letting the canvas clip — uniform across all elements, no per-element math. Only L↔R; vertical wrap is deliberately off because with gravity the chain hangs down and a fallen chain teleporting to the top reads badly. The wrap test includes the handle's radius so the opposite-side image doesn't flicker. Drop the height term back in `drawAlex2` to re-enable full wrap.

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

**Bending** is **linear**: V_pair(Δθ) = (1/2)·k_θ·Δθ², so `V'(Δθ) = k_θ·Δθ` with `k_θ = BENDING_EI / L`. The generalized bending force on θ_j is the discrete Laplacian `k_θ·(θ_{j−1} − 2·θ_j + θ_{j+1})` with Neumann (free-end) boundary conditions.

We previously had a nonlinear anti-folding model with `V'(Δθ) = 2·k_θ·tan(Δθ/2)` plus a Δθ-based clamp near ±π, intended to prevent the rope from passing through itself. It turned out to be **physically wrong** — the periodic tan(Δθ/2) form gave the bending force a sign-flip past every odd multiple of π (force "aiding" rather than "restoring"), which under sustained heavy forcing caused runaway in the integrator. Real bending energy isn't periodic in Δθ — winding around adds energy. Linear bending captures this correctly and is robust under any forcing. We accept that loops can form as a consequence; if anti-folding behavior is desired later, the right form is linear + a non-periodic soft barrier (e.g. `β·exp(c·(|Δθ| − π_max))`), NOT a periodic tan-based form. See [Alex2/tests/FINDINGS.md](Alex2/tests/FINDINGS.md) for the diagnosis.

**Strain-rate damping** is the linear discrete Laplacian on θ̇ (same Neumann BCs): pulls each joint's angular velocity toward its neighbors'. Zero effect on rigid rotation (all θ̇ equal → Laplacian = 0), suppresses high-frequency / alternating-sign modes exponentially. Coefficient `DAMPING_BEND`.

**Mass damping** subtracts `DAMPING_MASS · θ̇` from θ̈ each frame — slowly bleeds off bulk rotation. Set to 0 to coast indefinitely.

### Naming note: Coriolis vs centrifugal

We call the `C` vector "Coriolis" in the code, following the robotics/multibody-dynamics convention where the lumped `C(q,q̇)·q̇` vector is named that way. **Physically the term is centrifugal**, not Coriolis: it is quadratic in a *single* angular velocity at each k (`θ̇_k²`), and Coriolis forces are bilinear in *two distinct* velocities. The actual Coriolis-character coupling in this system lives in the cross term of the kinetic energy (`m·ȧ_anchor · L·R(θ_k)·θ̇_k`, bilinear in anchor velocity and segment angular velocity), where the anchor-velocity × segment-rotation pairing has the textbook Coriolis structure. In the 2D pure-translation case, the Euler-Lagrange algebra collapses that cross term into the `Q_anchor` acceleration coupling we have, so no explicit anchor-velocity term appears in the EOM — the Coriolis character is structural (which variables couple), not necessarily a separate surviving term. **Code keeps the conventional name; this note records the physical reading.**

## Integration

**Active integrator: implicit midpoint** (γ = 0.5), selected by `INTEGRATOR = 'implicit-midpoint'`. The scheme is γ-parametrized: γ = 0.5 gives the symplectic implicit midpoint (default — A-stable, symmetric, conserves quadratic invariants → bounded energy error), γ = 1.0 gives L-stable implicit Euler (adds artificial high-frequency damping). Explicit RK4 (`INTEGRATOR = 'rk4'`) is kept as the legacy path for comparison; it was the original default but is fragile to stiff forcing (see Known limitations).

Each substep solves the implicit update `F(y_{n+1}) = 0` for `y = [θ, θ̇]` with Newton's method (`NEWTON_MAX_ITERS = 8`, `NEWTON_TOL = 1e-6`). Each Newton iteration builds M, the Coriolis vector, and the Jacobian blocks at the evaluation state (O(N²)), then solves a dense Ns×Ns system by Gaussian elimination with partial pivoting (O(N³)). Cost is therefore (Newton iters) × (1 build + 1 solve) per substep, and it dominates the frame. At the **current default N=50 / 16 substeps** this runs **unclamped real-time** (~60 fps phone, ~75 fps desktop) at rest, eating ~60% of the frame; under hard mouse-driving Newton needs more iterations and physics spikes to ~97% of the frame. The old N=100 / 32 default ran at ~10–20 fps (slow-motion / clamped) — see Known limitations for the cut and its consequences.

**Newton initial guess — warm start** (`NEWTON_WARM_START`, default true): each substep seeds Newton from the *previous converged substep's realized increment*, `y⁰ = yₙ + Δy_prev`, instead of one explicit-Euler step `y⁰ = yₙ + h·f(yₙ)`. Δy_prev is bounded physical motion, so it cannot overshoot Newton's convergence basin the way `h·θ̈` can once θ̈ is large — which is exactly the failure mechanism diagnosed below. Falls back to explicit Euler when no prior increment exists (first substep after Reset, an arrow-key impulse, or a non-converged step — all of which invalidate the stored increment). Bonus: the warm path skips the explicit-Euler build+solve, saving one O(N³) solve per substep.

**Internal substepping** (`IMPLICIT_SUBSTEPS_PER_FRAME = 16`): each real frame takes that many implicit substeps of size `h / 16`. Total physics time per real frame is unchanged (= h), so anchor and chain stay in lockstep — no anchor-vs-chain time mismatch. At the old N=100, 32 was the smallest count that held under deliberate hard driving and 16 failed; at the current N=50 the matrices and θ̈ are smaller, so **16 holds for normal play** and only blows up under deliberate hard jerks that drive the frame into the clamp (Known limitations). Refining h (more substeps) is one robustness lever, but per project direction we are *not* pursuing smaller h or adaptive stepping — see Future directions. RK4 uses `RK4_SUBSTEPS_PER_FRAME` instead.

### Smooth anchor delivery

Mouse-drag velocity changes are converted to a smooth anchor acceleration:
```
ax = Δv_x / h,   ay = Δv_y / h
```
which is passed to `Q_anchor` during the per-substep Newton evaluations (constant across the internal substeps within one real frame). This delivers the same total angular-momentum impulse but spreads it across the chain's integration, so the quadratic Coriolis term doesn't see a Δv-induced velocity jump at every substep. Without this smoothing, mouse impulses caused the chain to explode much more easily.

Arrow-key kicks bypass this entirely: they apply an exact angular-momentum impulse `M · Δθ̇ = L · μ_{jj} · (sin θ_j · Δv_x − cos θ_j · Δv_y)` directly inside the keydown handler. Cheap and stable.

## Tunables (top of [alex2-physics.js](Alex2/alex2-physics.js))

| Constant | Default | Role |
|---|---|---|
| `N` | 50 | Number of particles in the chain (joints = N − 1); cut from 100 for real-time framerate |
| `ROPE_LENGTH_FRACTION` / `_H` | 0.45 / 0.3 | Chain length = `max(0.45·width, 0.3·height)` (height term keeps it long enough on narrow screens) |
| `INITIAL_THETA` | π/2 | Initial joint angle — straight down (gravity equilibrium) |
| `M_ROPE` | 1 | Total chain mass (excluding anchor) |
| `GRAVITY` | 1000 | Downward accel (px/s²) on the chain + anchor; 0 disables |
| `INTEGRATOR` | `'implicit-midpoint'` | Active integrator: `'implicit-midpoint'` (γ=0.5), `'implicit-euler'` (γ=1.0), or legacy `'rk4'` |
| `IMPLICIT_SUBSTEPS_PER_FRAME` | 16 | Implicit substeps per real frame; 16 holds at N=50 for normal play (was 32 at N=100) |
| `NEWTON_WARM_START` | true | Seed Newton from previous substep's increment vs. explicit Euler (see Integration) |
| `NEWTON_MAX_ITERS` / `NEWTON_TOL` | 8 / 1e-6 | Per-substep Newton iteration cap and convergence tolerance |
| `RK4_SUBSTEPS_PER_FRAME` | 16 | Substeps for the legacy RK4 path only |
| `ANCHOR_KEY_VELOCITY_STEP` | 50 px/s | Arrow-key impulse magnitude |
| `BENDING_EI` | 1 | Continuum flexural rigidity; `k_θ = BENDING_EI / L` |
| `DAMPING_BEND` | 1000 | Strain-rate (discrete Laplacian on θ̇) damping coefficient |
| `DAMPING_MASS` | 0.5 | Mass-proportional damping coefficient (only thing that damps bulk rotation) |
| `USE_ANCHOR_SPRING` | true | Mouse→anchor spring + handle (the shipping control) |
| `SPRING_K` | 800 | Spring stiffness (higher = more precise/rigid control, less low-pass filtering) |
| `SPRING_DAMP` | 25 | Damping on the anchor's velocity (≈ near-critical scales as √(K·mass)) |
| `ANCHOR_MASS` | 2 | Anchor inertia; bigger = smoother/laggier, smaller `ax` |
| `SPRING_REST_FRAC` | 0.16 | Spring rest length as a fraction of min(w,h) — the idle handle offset |
| `HANDLE_GRAB_RADIUS_FRAC` | 1/6 | Handle finger hit-target (big, for narrow screens) |
| `HANDLE_MARKER_RADIUS_FRAC` | 1/15 | Drawn handle radius |
| `USE_CHAIN_WRAP` | true | Horizontal-only toroidal wrap of the whole scene |

### Diagnostic flags (flip individually to investigate)

| Flag | What it logs |
|---|---|
| `NEWTON_LOG_ENABLED` | Per-frame per-substep Newton (iters, relStep, converged). **Gated to print only problem frames** — any substep that fails to converge (`converged < substeps`) or strains near the iter cap (≥ `NEWTON_MAX_ITERS − 2`); healthy frames stay silent. The headline `converged=X/Y` distinguishes a numerical failure (Newton diverged) from a physical one |
| `ENERGY_MONITOR` | E = ½ θ̇ᵀ M θ̇ per frame; spike/NaN warnings when E_new / E_prev > `E_SPIKE_RATIO`. An energy spike *with* Newton converged = legitimate forcing; *with* Newton failed = numerical breakdown |
| `THETA_LOG_ENABLED` | Buffers θ at three fixed joints per frame (silent); `window.alex2.dumpThetaLog()` downloads a CSV. `window.alex2.dumpFullState(label)` dumps all θ/θ̇ to CSV + JSON |
| `TRACE_ENABLED` | Per-frame θ_j values (head + tail) for `TRACE_DURATION_FRAMES`; stops on NaN |
| `CONDITION_ESTIMATE` | Spectral κ₂(M) via power iteration (λ_max) + inverse power iteration (λ_min). Confirmed M conditioning is **not** the cause of explosions — κ stayed ~1.5e4 throughout failures |
| `SUBSTEP_LOG_ENABLED` | Per-substep RHS and θ̈ for the first `SUBSTEP_LOG_HEAD` joints. **RK4 only** — `captureSubstep` is wired into `rk4Step`, not the implicit path, so it records nothing under implicit midpoint |
| `INPUT_LOG_ENABLED` | Per-frame anchor position / velocity / acceleration in px-per-frame units (same scale as L ≈ 4 px), gated alongside the trace so frame indices align with the substep log |
| `SHOW_PERF_HUD` | **On-canvas** overlay (top-left), not console — for comparing devices and reading the frame budget. Shows FPS + real frame interval (wall-clock, ignores the dt clamp), integrator-only physics ms and its % of frame, and raw dt with a **⚠ CLAMPED** flag when main.js's 33 ms ceiling fires. Default on. Note FPS/frame-ms include the other diagnostic monitors, so turn `ENERGY_MONITOR` / `NEWTON_LOG_ENABLED` off for an honest framerate reading |

Most outputs go to the console; the θ / substep / input logs download as CSV (substep/input dump when tracing stops; θ on demand). The perf HUD draws on-canvas instead.

## Known limitations

- **Blow-up mechanism (diagnosed 2026-06, implicit midpoint)** — under hard forcing the chain can still NaN. The cause is **numerical, not physical**: at the blow-up frame Newton stops converging (`converged < substeps`, relStep ~ O(1)) *before* energy explodes, and the energy jumps ~10³⁰× in one frame — impossible for the bounded-energy physical system. Root cause is **Newton's initial guess overshooting its convergence basin**: large M⁻¹ → large θ̈ → the explicit-Euler guess `yₙ + h·θ̈` lands outside the basin → Newton diverges → spurious energy → self-reinforcing collapse (no recovery once it starts). Confirmed across two substep counts; conditioning of M is *not* involved (κ stayed ~1.5e4). **Warm start (above) is the fix** — it raises the failure threshold dramatically by seeding from bounded realized motion. It is a strict improvement but not a total cure: at 16 substeps deliberate hammering can still cross the (now much higher) threshold; **32 substeps + warm start held under deliberate abuse**. *Caveat:* part of 32's apparent robustness is a frame-rate confound — at ~10–20 fps the anchor lags the mouse, throttling how hard the chain can actually be driven; 16 runs faster, so it can be driven harder, which is one reason it fails where 32 doesn't.
- **Performance & the N=50 / 16-substep cut (2026-06-10)** — the per-substep Newton solve (O(N³) × iters × substeps) dominates the frame. At the old N=100 / 32 it ran ~10–20 fps, *below* 30 fps even at rest, so main.js's 33 ms dt-clamp fired permanently → physics ran in slow motion, and the slow-motion rate differed by device (phone advanced more physics-time/sec than the slower desktop) — that, not a physics difference, was why the chain "felt different" across devices. Cutting to **N=50 (≈5× via O(N³)) + 16 substeps (≈2×)** put both devices unclamped at real-time (~60 fps phone / ~75 fps desktop, ~60% physics at rest, ~97% under hard drive). The cross-device feel converged the moment the clamp cleared. Reducing damping for a livelier feel will lower the blow-up threshold (faster motion → larger θ̈) — liveliness and stability trade off.
- **Blow-up at N=50 / 16 is gated by the dt-clamp (2026-06-10)** — under *deliberate* hard jerks (rare in normal play) the chain still NaNs, and the blow-up coincides exactly with the clamp re-appearing. Causal chain: hard jerk → Newton iters spike → frame slows past 33 ms → clamp fires → smooth-delivery `ax = Δanchor / h` is computed with `h` pinned at 33 ms while the real frame was longer → the delivered anchor acceleration is **inflated** → larger θ̈ → Newton overshoots its basin → blow-up. So a slow frame manufactures an artificial forcing spike; the clamp *feeds* the explosion rather than protecting against it. Both planned fixes attack this — the mouse→anchor spring bounds `ax` at the source, and a fixed-timestep accumulator would remove the clamp-inflation entirely.
- **Long-persistent "chaos"** at default damping — brief mouse inputs can trigger a regime where the chain keeps moving for *much longer* than the mass-damping time-constant (~10 sec at `α = 0.1`) would predict. This is a *separate* phenomenon from the blow-up above and is most likely **genuine bounded Hamiltonian chaos** (an N−1 link chain is a generalized multi-pendulum with positive Lyapunov exponents), not a numerical artifact — sensitive, energy-conserving wandering that only decays on the slow damping timescale. Higher damping suppresses it at the cost of sluggish feel; not further pursued.
- **Spring made the blow-up recoverable, not impossible (2026-06-10)** — with the mouse→anchor spring in place, a hard jerk still spikes Newton (fps dips to ~5, then climbs back) but no longer NaNs permanently: the spring removed the clamp-inflation feedback, so the solver re-converges and it self-heals. *Residual:* an **involuntary** hand jerk is sharper than a deliberate one and can still trigger a chaos episode; sometimes it plateaus at a sustained ~22 fps (Newton chronically near its iter cap, energy injection ≈ damping removal) rather than fully recovering. An anti-chaos mechanism is the next planned fix (deliberately deferred so it doesn't mask the raw behavior).
- **No friction / no collisions; gravity is now on** — gravity was added (chain + anchor; see "What Alex2 is"). Friction and self/wall collisions are still out by design — physically-correct chain-floor collision in reduced coordinates is a large separate project; for now the chain may pass off-screen (the wrap is horizontal-only, so it doesn't reappear at the top).

## Future directions

The next phase targets **feel and input-limiting**, not integrator robustness. Per project direction we are explicitly **not** pursuing smaller h, adaptive step-rejection, or line-search Newton.

- **Mouse→anchor spring — DONE (2026-06-10).** Implemented as the shipping control (see "What Alex2 is"). It bounds `ax` at the source and turned the irrecoverable NaN into a recoverable transient. Open follow-up: a stiffer `SPRING_K` (set for control feel) passes jerks through more directly — less low-pass filtering — so it trades against blow-up margin.
- **Anti-chaos mechanism (next)** — the user has an idea, deferred so it doesn't mask the current raw behavior. Targets the residual involuntary-jerk chaos / 22 fps plateau (Known limitations).
- **Tune the fraction "scale" (parked)** — the size-fractions (handle radii, spring rest, etc.) are computed off `min(w,h)` and were set provisionally; the reference scale and the numbers are to be revisited together.
- **Wrap the spring/handle visual edge cases (parked)** — currently fine for the horizontal wrap; revisit if a tethered element reads badly crossing a seam.
- **Breakable rope** — let a joint *tear* when its θ̈ exceeds a limit; embraces the failure as a mechanic.
- **Performance** — the dense O(N³) solve per Newton iter dominates. Note the reduced-coordinate **mass matrix M is dense, not banded** (the lumped-mass `μ` couples every joint pair), so a banded solver does *not* apply directly; the real O(N) lever for a chain is the articulated-body / Featherstone recursion, which never forms M — a larger reformulation.

Earlier integrator notes, now resolved or shelved: implicit midpoint (the old "B3") is **implemented and is the default**; symplectic Verlet/Yoshida ("B4") is still explicit with the same θ̈·h² sensitivity and is not pursued.

## Sizing

Chain length is `max(width·ROPE_LENGTH_FRACTION, height·ROPE_LENGTH_FRACTION_H)`; segment length `L = chainLength / (N − 1)`. Anchor marker/grab radii (`ANCHOR_MARKER_RADIUS_FRAC`, `ANCHOR_GRAB_RADIUS_FRAC`) and handle marker/grab radii (`HANDLE_MARKER_RADIUS_FRAC`, `HANDLE_GRAB_RADIUS_FRAC`) are fractions of `min(w,h)`. (These fractions are provisional — see Future directions.)

## Reset behavior

The Reset button (handler in [controls.js](controls.js)) resets the anchor to its initial position, parks the handle above the anchor, releases any held grab, and zeros all `θ` and `θ̇` (chain back to straight-down). Tracing/logging buffers also restart so a Reset gives clean repeatable runs.
