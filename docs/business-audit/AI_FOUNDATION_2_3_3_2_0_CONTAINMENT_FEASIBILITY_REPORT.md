# Auravo Studio — AI-Foundation 2.3.3.2.0
## Zero-Cost Worker Containment Alternatives & Platform Feasibility Assessment

**Document ID:** `AURAVO-AIF2.3.3.2.0-CONTAINMENT-FEASIBILITY-REPORT-20261118`  
**Phase:** AI-Foundation 2.3.3.2.0  
**Mode:** STRICT READ-ONLY FORENSIC & ARCHITECTURAL FEASIBILITY ASSESSMENT  
**Date:** November 18, 2026  
**Repository:** `/Users/abhisheksuman/Documents/GitHub/studio`  
**Branch:** `main`  
**Expected Baseline HEAD:** `e427970c7341736c28fc1365562b4bb4e09e3ae5`  
**Active HEAD:** `fafda6bedfee3923ff6e91fe36f18d0066962759` (clean fast-forward containing commit `fafda6b` with Nov 18 audits)  
**Previous Phase:** AI-Foundation 2.3.3.1 — Application-Level PASS; Platform Containment Blocker  
**Next Implementation Phase:** NOT AUTHORIZED  
**Active Database Path:** `data/studio.db`  
**Active Database SHA-256:** `f804c78f5fceb50ce1525a5b50c12e8b21302863b6931b8110ce716cf40eb4a8` (466,944 bytes, 12 migrations, 0 active reservations, integrity: `ok`)  
**Expected Prompt Database Baseline:** `73276052355de0905a61e8d4acbd8772e74e5f4613d866ac02d5bfa9c2c46ed5` (196,608 bytes) — *Discrepancy documented in Section 11*  
**Target Hardware:** Apple Silicon M3 Pro (18 GB Unified Memory, macOS Darwin `arm64`)  
**Monetary Budget & Spend:** $0.00 (Strictly zero cost; no paid APIs, cloud instances, or paid services)

---

## 1. Executive Summary

Phase AI-Foundation 2.3.3.2.0 was commissioned as a strict read-only forensic and architectural feasibility assessment to investigate whether Auravo Studio can safely support isolated AI worker processes under its non-negotiable **$0.00 monetary budget** constraint.

The preceding Phase 2.3.3.1 established a hardened application-level supervision layer (achieving 100% test pass rates across 89 remediation tests, 25 coordinator tests, and 45 lifecycle tests). However, that phase uncovered an insurmountable operating-system containment limitation on macOS: **POSIX process groups provide cooperative process grouping, not inescapable kernel containment.**

### 1.1 Core Assessment Findings
1. **The macOS User-Space Boundary is Strictly Cooperative:**  
   On macOS, an uncooperative or rogue child process can escape its process group at any time by executing `setsid()` or using double-fork patterns (`fork()` + `fork()`). Once a child calls `setsid()`, it severs all linkage to its original process group (`pgid`). Signals dispatched to `-pgid` never reach detached sessions, and descendants reparented to `launchd` (PID 1) become completely invisible to parent-child tree traversals.
2. **Native macOS Alternatives Do Not Solve the Problem for Unprivileged Apps:**  
   - `launchd` job tickets are designed for long-running system daemons; dynamic job submission via `launchctl submit` is deprecated and fails with `EPERM` in sandboxed or unprivileged contexts.
   - `sandbox-exec` / Seatbelt is deprecated (since macOS 10.8), blocked inside sandboxed applications, and cannot prevent `setsid()` without disabling process creation entirely.
   - `EndpointSecurity.framework` requires root privilege, System Integrity Protection (SIP) modifications, and a paid Apple Developer Program membership ($99/year) to obtain the required entitlement, which violates the $0.00 budget constraint.
3. **Linux Offers Genuine Kernel-Level Containment at $0.00:**  
   On modern Linux (kernel >= 5.14), **cgroup v2** (`cgroup.kill`) and **systemd transient scopes** (`systemd-run --scope --user`) provide inescapable, atomic kernel containment without root privileges. Any process assigned to a cgroup leaf node—and every descendant it ever spawns, regardless of `setsid()` or double-forking—is irrevocably captured and atomically reaped upon cgroup termination.
4. **Local Virtualization on Apple Silicon Introduces a Fatal GPU Bottleneck:**  
   While running a local Linux VM on macOS (via Lima, QEMU, or Apple's `Virtualization.framework`) is free and open-source (`FREE_OPEN_SOURCE_LOCAL`), **macOS hypervisors cannot pass through Apple Silicon Metal / MPS GPU acceleration to Linux guests**. A Linux guest running on Apple Silicon has zero access to the M3 Pro GPU for PyTorch MPS. Executing SDXL character generation in a Linux VM forces CPU-only inference, exploding execution latency from 16–19 seconds to 20–30+ minutes per image.
5. **No Cloud or Remote Paid Workarounds Are Permitted:**  
   Cloud GPU rentals (RunPod, Modal, Colab Pro, AWS) require payment and are strictly prohibited under Auravo's zero-cost mandate. Free-tier hosted services introduce quota, network, and privacy liabilities and cannot be relied upon for core inference.

### 1.2 Summary of Assessment Verdicts

```
====================================================================================================
APPLICATION-LEVEL SUPERVISION STATUS: PASS
PLATFORM-LEVEL CONTAINMENT STATUS:    BLOCKED_BY_INSUFFICIENT_CONTAINMENT (on macOS)
ARCHITECTURAL FEASIBILITY STATUS:     CONDITIONALLY_FEASIBLE_WITH_PLATFORM_CHANGE (to Linux)
OVERALL PHASE-GATE DECISION:          PHASE 2.3.3.2 (SDXL INTEGRATION) REMAINS STRICTLY BLOCKED
====================================================================================================
```

**Recommendation:** Retain the current blocker on macOS. Do not integrate external untrusted child worker processes on macOS. Keep macOS execution restricted to cooperative, trusted workloads (Ollama HTTP daemon, FFmpeg CLI). If inescapable worker containment is mandatory, defer AI worker execution until Auravo operates on a Linux host equipped with native cgroups v2.

---

## 2. Current Architecture & Existing Containment Boundary

A rigorous inspection of the current codebase ([`server/coordinator/coordinator.ts`](file:///Users/abhisheksuman/Documents/GitHub/studio/server/coordinator/coordinator.ts), [`server/coordinator/child_supervisor.ts`](file:///Users/abhisheksuman/Documents/GitHub/studio/server/coordinator/child_supervisor.ts), [`server/coordinator/process_identity.ts`](file:///Users/abhisheksuman/Documents/GitHub/studio/server/coordinator/process_identity.ts), [`server/coordinator/persistence.ts`](file:///Users/abhisheksuman/Documents/GitHub/studio/server/coordinator/persistence.ts), and [`server/index.ts`](file:///Users/abhisheksuman/Documents/GitHub/studio/server/index.ts)) establishes the precise boundaries of the existing system.

### 2.1 The Five-Tier Architectural Hierarchy
The codebase currently implements distinct operational tiers. These must not be conflated:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 5: Kernel-Enforced Containment (MISSING ON MACOS)                │
│ Inescapable boundary (cgroups v2, PID namespaces). Cannot be bypassed  │
│ by setsid(), double-fork, or uncooperative binaries.                   │
├────────────────────────────────────────────────────────────────────────┤
│ Tier 4: Process-Tree Termination (COOPERATIVE ONLY ON MACOS)           │
│ Dispatches SIGTERM/SIGKILL to process group (-pgid). Only affects      │
│ processes that remained within the original process group.             │
├────────────────────────────────────────────────────────────────────────┤
│ Tier 3: Process-Tree Observation (HEURISTIC / COOPERATIVE)             │
│ Scans stderr/stdout for DETACHED_PID markers; inspects OS process      │
│ snapshots via ps -o pid,ppid,pgid. Subject to TOCTOU races.            │
├────────────────────────────────────────────────────────────────────────┤
│ Tier 2: Process Identity Verification (DETERMINISTIC / VERIFIED)       │
│ Checks PID, PPID, PGID, lstart, command name against durable SQLite   │
│ records. Prevents targeting recycled PIDs or unrelated OS processes.   │
├────────────────────────────────────────────────────────────────────────┤
│ Tier 1: Process Supervision (DETERMINISTIC / COMPLETE)                 │
│ ChildProcess handle tracking, JSON-lines protocol parsing, execution   │
│ timeouts, bounded stdout/stderr buffering, graceful SIGTERM ladder.    │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 ResourceCoordinator Admission & Exclusivity
- **Central Mutual Exclusion ([`coordinator.ts:123-180`](file:///Users/abhisheksuman/Documents/GitHub/studio/server/coordinator/coordinator.ts#L123-L180)):**  
  Enforces single-active workload serialization via `ResourceCompatibilityPolicy.areCompatible()`. `LLM_INFERENCE` and `SDXL_IMAGE_GENERATION` are mutually exclusive.
- **Fail-Closed Locking ([`coordinator.ts:133-142`](file:///Users/abhisheksuman/Documents/GitHub/studio/server/coordinator/coordinator.ts#L133-L142)):**  
  If any reservation enters `RECOVERY_REQUIRED`, the coordinator enters `RECOVERY_REQUIRED` and immediately locks out all subsequent `acquire()` requests with a `ResourceCoordinatorError('RECOVERY_REQUIRED')`.
- **Pre-Admission Model Unload ([`coordinator.ts:630-710`](file:///Users/abhisheksuman/Documents/GitHub/studio/server/coordinator/coordinator.ts#L630-L710)):**  
  Before granting admission to an SDXL request, the coordinator verifies whether Ollama has a resident model via `/api/ps`. If resident, it forces an unload via `/api/generate` (`keep_alive: 0`) and polls `/api/ps` for verified absence. If Ollama cannot be verified as empty, SDXL admission is rejected fail-closed.

### 2.3 ChildProcessSupervisor Lifecycle & Isolation
- **Process Group Creation ([`child_supervisor.ts:309-320`](file:///Users/abhisheksuman/Documents/GitHub/studio/server/coordinator/child_supervisor.ts#L309-L320)):**  
  Workers are spawned with `detached: process.platform !== 'win32'`, which invokes POSIX `setpgid(0, 0)`. On POSIX, the child process becomes the leader of a new process group where `pgid === child.pid`.
- **Spawn Snapshot Validation ([`child_supervisor.ts:398-421`](file:///Users/abhisheksuman/Documents/GitHub/studio/server/coordinator/child_supervisor.ts#L398-L421)):**  
  Upon the `'spawn'` event, `validateSpawnSnapshot` inspects the OS process table via `getProcessSnapshot(pid)`. It verifies that the operating system reports matching PID, valid PGID, and an allowlisted state (`RUNNING` or `SLEEPING`). Only when validated does it assign `pgidVerificationState = 'OS_VERIFIED'`. If the snapshot is inaccessible or inconsistent, the provenance remains `UNVERIFIED`.
- **Termination Ladders ([`child_supervisor.ts:718-775`](file:///Users/abhisheksuman/Documents/GitHub/studio/server/coordinator/child_supervisor.ts#L718-L775)):**  
  Cancellation executes a two-stage ladder:
  1. *Stage 1 (Graceful):* Sends `SIGTERM` to the process group (`-pgid`) or direct PID. Keeps stdio open for a bounded grace period (`terminationGracePeriodMs`, default 2,000ms) to allow the worker to flush `SHUTDOWN_ACK`.
  2. *Stage 2 (Escalation):* If still alive, escalates to `SIGKILL` (`sendVerifiedSignal(pid, pgid, 'SIGKILL')`).
  3. *Stage 3 (Verification):* Evaluates direct child status and process group liveness (`checkProcessGroupLiveness`). Stdio streams are destroyed only after verification settles.

### 2.4 Persistence & Multi-Alias PGID Resolution
- **Durable Identity Record ([`persistence.ts:50-130`](file:///Users/abhisheksuman/Documents/GitHub/studio/server/coordinator/persistence.ts#L50-L130)):**  
  Persists `workerIdentity` in `resource_reservations.metadata`. Durably stores `childPid`, `childPgid`, `pgidVerificationState`, `parentPid`, `processStartedAt`, `lstart`, and `command` (with all arguments sanitized via `sanitizeDiagnostic`).
- **Atomic Multi-Alias Resolution ([`process_identity.ts:116-290`](file:///Users/abhisheksuman/Documents/GitHub/studio/server/coordinator/process_identity.ts#L116-L290)):**  
  `resolveProcessGroupIdentity` cross-validates aliases (`childPgid` vs `pgid`) within and across `workerIdentity` and `reservation.metadata`.
  - Conflicting values, malformed single aliases (`-1`, `0`, non-integer, string, `NaN`), or unanchored provenance (claiming `OS_VERIFIED` without a valid PGID) strictly fail closed with `hasConflict: true`, `pgid: undefined`, and `pgidVerificationState: 'UNVERIFIED'`.

### 2.5 Startup Recovery Ordering
- **Strict Boot-Time Gating ([`server/index.ts:25-45`](file:///Users/abhisheksuman/Documents/GitHub/studio/server/index.ts#L25-L45)):**  
  Before `app.listen()` binds to the network port, `ChildProcessSupervisor.reconcileOrphanedWorkerReservations` evaluates all unmanaged reservations:
  1. If a dead child worker has confirmed `OS_VERIFIED` provenance and its process group is confirmed `EMPTY`, it safely transitions the reservation to `RELEASED`.
  2. If a dead worker has `UNVERIFIED` provenance, metadata conflicts, or if the process group contains `LIVE_MEMBERS`, `UNKNOWN`, or `ERROR`, the supervisor transitions the reservation to `RECOVERY_REQUIRED` and permanently locks the coordinator fail-closed.

---

## 3. macOS-Native Containment Assessment

An architectural and operating-system assessment was conducted for all available macOS native mechanisms:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                macOS Native Mechanism Evaluation                                │
├──────────────────────┬────────────────────────┬──────────────────────┬──────────────────────────┤
│ Mechanism            │ Kernel Containment?    │ Unprivileged User?   │ Production Viability     │
├──────────────────────┼────────────────────────┼──────────────────────┼──────────────────────────┤
│ POSIX Process Groups │ NO (Bypassed by setsid)│ YES                  │ COOPERATIVE ONLY         │
│ posix_spawn PGID     │ NO (Bypassed by setsid)│ YES                  │ COOPERATIVE ONLY         │
│ launchd Job Tickets  │ PARTIAL (Deprecated)   │ NO (Requires Plist)  │ INFEASIBLE FOR WORKERS   │
│ Seatbelt / Sandbox   │ NO (Deprecated / EPERM)│ NO (Nested EPERM)    │ DEPRECATED / BLOCKED     │
│ EndpointSecurity     │ YES (Kernel Intercept) │ NO (Requires Root)   │ BLOCKED ($99/yr Apple ID)│
│ libproc / ps polling │ NO (Observation only)  │ YES                  │ TOCTOU RACE PRONE        │
└──────────────────────┴────────────────────────┴──────────────────────┴──────────────────────────┘
```

### 3.1 POSIX Process Groups & Sessions (`setpgid`, `setsid`)
- **What it Guarantees:**  
  When a child process is spawned with `detached: true`, Node.js invokes `setpgid(0, 0)`. The child becomes the process group leader (`pgid === child.pid`). All cooperative child processes and threads spawned by the worker inherit this process group ID. A signal dispatched to `-pgid` (via `process.kill(-pgid, signal)`) is broadcast by the kernel to every member of that group.
- **What it CANNOT Guarantee:**  
  POSIX explicitly defines `setsid()` as creating a new session and a new process group, with the calling process becoming the session leader and group leader. Any process that executes `setsid()` leaves the original process group. The parent process receives no kernel notification of this transition. Subsequent signals dispatched to the original `-pgid` have zero effect on the detached session.
- **Double-Fork Vulnerability:**  
  If a worker executes `fork()` -> `fork()` and the intermediate child exits, the grandchild is reparented by the kernel to PID 1 (`launchd`). The grandchild severs all process group linkage and parent-PID hierarchy.
- **Verdict:** `COOPERATIVE_ONLY`. Insufficient for uncontained or untrusted worker isolation.

### 3.2 `launchd` Job Management & Lifecycle Semantics
- **What it Guarantees:**  
  `launchd` (PID 1 on macOS) manages system and user services. Processes spawned under a `launchd` job label belong to a managed job context. When `launchd` terminates a job (`launchctl bootout` or `launchctl kill`), it terminates the entire job tree.
- **What it CANNOT Guarantee for Ephemeral Workers:**  
  1. *Deprecation of Dynamic Submission:* The `launchctl submit` command was formally deprecated in OS X 10.10 (Yosemite). Apple's modern service management framework (`SMAppService` / `launchctl bootstrap`) requires writing a persistent `.plist` XML configuration to `~/Library/LaunchAgents/` or `/Library/LaunchDaemons/`.
  2. *High Latency and File Pollution:* Generating, writing, loading, bootstrapping, kicking off, tearing down, and unlinking a `.plist` file on the filesystem for a single one-shot AI image generation request introduces high disk I/O overhead and complex error recovery if the parent crashes mid-cycle.
  3. *Unprivileged Sandbox Failure:* In restricted environments (including macOS app sandboxes or unprivileged automated runner contexts), calling `launchctl bootstrap` fails with `EPERM` or `Bootstrap failed: 5: Input/output error`.
- **Verdict:** `INFEASIBLE_FOR_EPHEMERAL_WORKERS`. `launchd` is an init daemon and service manager, not an ephemeral process-isolation sandbox.

### 3.3 macOS App Sandbox & Seatbelt (`sandbox-exec`)
- **What it Guarantees:**  
  Apple's Seatbelt engine (`/usr/bin/sandbox-exec` and `libsystem_sandbox.dylib`) enforces mandatory access control (MAC) policies defined in Scheme-based `.sb` profiles. It can restrict filesystem paths, network interfaces, and Mach lookup services.
- **What it CANNOT Guarantee:**  
  1. *Deprecation:* Apple explicitly marked `sandbox-exec` as deprecated in OS X 10.8 (Mountain Lion). It is undocumented, unmaintained, and subject to removal in future macOS releases.
  2. *Nested Sandbox Invocations Fail with EPERM:* If Auravo Studio runs within an existing user sandbox or restricted context, any attempt by Node.js to execute `sandbox-exec` immediately throws `spawn EPERM` (as verified empirically in our terminal sandbox testing).
  3. *No Process-Tree Containment:* A Seatbelt profile can restrict file read/write, but it does NOT prevent a child process from invoking `setsid()` or surviving parent process exit unless process creation (`process-fork`) is completely denied. Denying `process-fork` makes it impossible to launch the Python runtime or its worker threads.
- **Verdict:** `DEPRECATED_AND_UNAVAILABLE`.

### 3.4 Endpoint Security Framework (`EndpointSecurity.framework`)
- **What it Guarantees:**  
  Apple's `EndpointSecurity` C API allows an authenticated client to receive synchronous kernel callbacks on system events, including `ES_EVENT_TYPE_AUTH_PROC_CHECK`, `ES_EVENT_TYPE_NOTIFY_FORK`, `ES_EVENT_TYPE_NOTIFY_EXEC`, and `ES_EVENT_TYPE_NOTIFY_EXIT`. It can intercept every child creation and prevent unauthorized `setsid()` invocations.
- **Why it is STRICTLY PROHIBITED:**  
  1. *Root / System Extension Requirement:* Must be packaged as a DriverKit / System Extension running as `root`.
  2. *Entitlement Barrier & Monetary Cost:* Requires the restricted entitlement `com.apple.developer.endpoint-security.client`. Apple only grants this entitlement to registered Apple Developer Program organizations paying **$99.00 USD/year**, and requires manual review and approval by Apple.
  3. *Zero-Cost Violation:* Introduces a mandatory recurring subscription cost, directly violating Section 2 of this phase.
- **Verdict:** `BLOCKED_BY_ZERO_COST_AND_ENTITLEMENT_BARRIER`.

---

## 4. Linux-Native Containment Assessment

In stark contrast to macOS, the Linux kernel provides first-class, unprivileged, inescapable container primitives:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 Linux Native Mechanism Evaluation                               │
├──────────────────────┬────────────────────────┬──────────────────────┬──────────────────────────┤
│ Mechanism            │ Kernel Containment?    │ Unprivileged User?   │ Production Viability     │
├──────────────────────┼────────────────────────┼──────────────────────┼──────────────────────────┤
│ cgroups v2           │ YES (cgroup.kill)      │ YES (via systemd)    │ PRODUCTION STANDARD      │
│ systemd User Scopes  │ YES (Transient Units)  │ YES (systemd --user) │ PRODUCTION STANDARD      │
│ PID Namespaces       │ YES (PID 1 Reaper)     │ YES (User Namespace) │ HIGHLY VIABLE            │
│ Bubblewrap (bwrap)   │ YES (Namespaces+PDEATH)│ YES                  │ HIGHLY VIABLE            │
│ Rootless Podman      │ YES (OCI Container)    │ YES                  │ VIABLE (Higher Overhead) │
└──────────────────────┴────────────────────────┴──────────────────────┴──────────────────────────┘
```

### 4.1 cgroup v2 (`cgroup.kill` & `cgroup.freeze`)
- **Kernel Mechanism:**  
  Linux control groups v2 (unified hierarchy, `/sys/fs/cgroup/`) organize processes into a strict hierarchical tree. Every process belongs to exactly one cgroup leaf.
- **Inescapable Guarantee:**  
  When a child process forks, the new child is automatically placed into the parent's cgroup. **A process cannot escape its cgroup without write permissions to the cgroup hierarchy.** Calling `setsid()`, `fork()`, or double-forking has zero effect on cgroup membership.
- **Atomic Kernel Termination (`cgroup.kill`):**  
  Introduced in Linux 5.14, writing `1` to `/sys/fs/cgroup/<path>/cgroup.kill` causes the Linux kernel to atomically deliver `SIGKILL` to every process in the cgroup. It eliminates all TOCTOU signalling races: no process can fork fast enough to evade `cgroup.kill`.
- **Zero-Cost & Unprivileged Status:**  
  Available out-of-the-box on all modern Linux distributions (Ubuntu >= 22.04, Debian >= 11, Fedora, Arch). Unprivileged users can manage their own delegated cgroups via `systemd --user`.
- **Verdict:** `FREE_OPEN_SOURCE_LOCAL`. Genuine kernel-enforced containment.

### 4.2 systemd Transient Scopes (`systemd-run --scope --user`)
- **Mechanism:**  
  A Node.js backend can spawn an ephemeral worker by wrapping the execution in:
  ```bash
  systemd-run --scope --user --unit=auravo-worker-<uuid> python worker.py
  ```
- **Lifecycle Control:**  
  `systemd` dynamically creates an isolated cgroup v2 scope for the worker. Termination is executed via:
  ```bash
  systemctl --user stop auravo-worker-<uuid>
  ```
  `systemd` guarantees that all processes in the unit are terminated before the command returns. If any process hangs, systemd escalates to `SIGKILL` after `TimeoutStopSec`.
- **Privilege & Integration:**  
  Runs entirely within the unprivileged user session (`systemd --user`). Requires zero root/sudo access and zero configuration files on disk.
- **Verdict:** `FREE_OPEN_SOURCE_LOCAL`. Cleanest Node.js integration pattern on Linux.

### 4.3 PID Namespaces & Bubblewrap (`bwrap`)
- **Mechanism:**  
  `clone(CLONE_NEWPID | CLONE_NEWUSER)` creates an isolated process tree where the root worker process is PID 1.
- **Containment Guarantee:**  
  Under POSIX PID namespace semantics, when PID 1 of a namespace exits or is killed, the Linux kernel immediately and automatically sends `SIGKILL` to every remaining process in that namespace. Escaping via `setsid()` is impossible because the session remains inside the PID namespace.
- **Bubblewrap (`bwrap`):**  
  An unprivileged, setuid-free CLI tool used by Flatpak. A Node.js backend can spawn workers with:
  ```bash
  bwrap --unshare-pid --die-with-parent --proc /proc --dev /dev python worker.py
  ```
  `--die-with-parent` uses the Linux `PR_SET_PDEATHSIG` ioctl to guarantee that if the Node.js server crashes, the kernel immediately delivers `SIGKILL` to the worker.
- **Verdict:** `FREE_OPEN_SOURCE_LOCAL`. Lightweight, robust namespace containment without daemons.

---

## 5. Alternative Execution Boundaries Assessment

We systematically evaluate five potential boundaries separating the Auravo Node.js server from external AI workers:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   Execution Boundary Comparison Matrix                                 │
├───────────────────────┬────────────┬──────────────────┬─────────────────┬──────────────────────────────┤
│ Boundary Model        │ Platform   │ Isolation Level  │ Cost Category   │ Apple Silicon GPU Access?    │
├───────────────────────┼────────────┼──────────────────┼─────────────────┼──────────────────────────────┤
│ 1. Same-Host Process  │ macOS      │ Cooperative Only │ FREE_LOCAL      │ YES (Direct MPS / Metal)     │
│ 2. Separate OS User   │ macOS      │ Filesystem Only  │ FREE_LOCAL      │ YES (Complex ACLs / Sudo)    │
│ 3. Local Linux VM     │ macOS Host │ Virtual Machine  │ FREE_LOCAL      │ NO (CPU ONLY — 20-30m/image) │
│ 4. Dedicated Machine  │ Linux Host │ Kernel (cgroups) │ FREE_LOCAL (*)  │ YES (If NVIDIA/AMD CUDA)     │
│ 5. Remote Cloud / GPU │ Cloud      │ Container / VM   │ REQUIRES_PAYMENT│ YES (PROHIBITED BY $0 RULE)  │
└───────────────────────┴────────────┴──────────────────┴─────────────────┴──────────────────────────────┘
(*) Requires existing Linux hardware; hardware purchase is prohibited.
```

### 5.1 Model 1: Separate Process on the Same macOS Host
- **Boundary:** Spawned subprocess running as the same macOS user (`uid`).
- **Hardware Acceleration:** Native Apple Silicon Metal / MPS access. Execution latency is 16–19 seconds per 1024x1024 image.
- **Containment:** **Weak / Cooperative.** Cannot prevent `setsid()` or double-fork escape.
- **Safety Posture:** Acceptable *only* if the worker code is 100% first-party, trusted, non-hostile, and adheres to cooperative protocol contracts. Unacceptable if workers can crash unpredictably or spawn untracked background daemons.

### 5.2 Model 2: Separate OS User on macOS
- **Boundary:** Spawning under a dedicated unprivileged user (`auravo_worker`) via `sudo -u` or `launchd`.
- **Containment:** Protects parent files via UNIX permissions (`0700`). Does NOT isolate unified memory or prevent background zombie/detached process leaks without root intervention.
- **Operational Flaws:** Requires passwordless `sudo` configuration or setuid wrappers, creating privilege escalation risks. Incompatible with standard local desktop app distribution.

### 5.3 Model 3: Local Linux Virtual Machine on macOS (Lima / UTM / QEMU)
- **Boundary:** Full hypervisor boundary using Apple's `Virtualization.framework` or QEMU. Inside the VM, Linux cgroups v2 and systemd provide complete process containment.
- **Cost Classification:** `FREE_OPEN_SOURCE_LOCAL` (Lima and UTM are Apache 2.0 / GPL).
- **CRITICAL FATAL DEFECT — Loss of Apple Silicon GPU Acceleration:**
  1. *Metal is Darwin-Exclusive:* Apple's Metal API, Metal Performance Shaders (MPS), and unified memory shader drivers are compiled into macOS Darwin system frameworks (`/System/Library/Frameworks/Metal.framework`).
  2. *No GPU Passthrough in Apple Virtualization:* Apple's `Virtualization.framework` exposes a generic VirtIO-GPU device to Linux guests supporting OpenGL 3D and simple Wayland/X11 rendering. It does **NOT** expose the Apple Neural Engine (ANE) or the Apple Silicon Metal compute GPU to Linux!
  3. *PyTorch MPS Incompatibility:* PyTorch's `torch.backends.mps` requires macOS Metal APIs. It cannot run inside a Linux VM.
  4. *Inference Explosion:* Without MPS, SDXL on Linux must execute on CPU via AVX/NEON instructions. Generating a single 1024x1024 SDXL image on CPU requires **20 to 35 minutes**, compared to **16 seconds** on native MPS.
  5. *Memory Penalty:* The Linux VM requires 4 GB to 6 GB of dedicated host RAM allocation on an 18 GB machine, creating constant memory contention with the host OS and Ollama.
- **Verdict:** `TECHNICALLY_FEASIBLE_BUT_OPERATIONALLY_UNUSABLE`.

### 5.4 Model 4: Dedicated Local Linux Machine
- **Boundary:** Physical Linux workstation running Ubuntu/Debian connected via local gigabit network.
- **Containment:** Complete kernel cgroup v2 containment via systemd scopes.
- **GPU Acceleration:** High-performance CUDA/ROCm inference if equipped with an NVIDIA or AMD GPU.
- **Cost Compliance:** Complies with $0.00 *only* if the user already owns dedicated Linux hardware. It cannot be mandated as a software prerequisite.

### 5.5 Model 5: Remote Cloud / GPU Endpoints
- **Boundary:** Remote container or serverless function (RunPod, Modal, Replicate, AWS SageMaker).
- **Cost Classification:** `REQUIRES_PAYMENT` ($0.20 to $0.80 per GPU hour).
- **Violation:** Strictly prohibited by Section 2. Auravo must not quietly depend on external billing.

---

## 6. Threat Model & Failure Scenarios Evaluation

We evaluate all 18 mandated failure scenarios against the current implementation and platform capabilities:

| # | Threat Scenario | Operating System Guarantee | Current Implementation Observation | ResourceCoordinator Action | Safe to Release? | RECOVERY_REQUIRED? |
|---|---|---|---|---|---|---|
| **1** | Worker exits normally (code 0) | Direct child exits; OS delivers SIGCHLD | Detects `code: 0`, parses terminal `SUCCESS` message | Transitions reservation to `TERMINATED`, releases | **YES** | NO |
| **2** | Worker hangs indefinitely | Process remains alive in OS table | `executionTimer` triggers `cancel('TIMEOUT')` | Escalates SIGTERM -> SIGKILL; verifies termination | **YES** (post-kill) | NO (if verified) |
| **3** | Worker ignores SIGTERM | OS ignores signal if custom handler or trapped | Bounded grace period expires; escalates to SIGKILL | Dispatches SIGKILL to PID / process group | **YES** (post-kill) | NO (if verified) |
| **4** | Worker ignores SIGKILL / un-reapable | Kernel cannot be blocked except in uninterruptible D-state | `waitForExitOrTimeout` expires; `isProcessAliveSync` returns true | Fails closed; refuses to certify termination | **NO** | **YES** |
| **5** | Worker creates cooperative child | Child inherits `pgid`; direct child exits | Direct child terminates; group check detects living members | Dispatches SIGTERM/SIGKILL to `-pgid`; verifies group empty | **YES** (post-kill) | NO (if group dead) |
| **6** | Worker creates detached child (`setsid`) | Kernel creates new session; PGID severed from parent | Supervisor group check reports empty; cannot observe detached session | Relies on `DETACHED_PID` stderr marker. If uncooperative: blind release | **NO** (blind leak) | **YES** (if detected) |
| **7** | Worker double-forks and exits parent | Grandchild reparents to PID 1 (`launchd`); parent dies | Direct child exit code 0 observed; PGID check may report empty | If grandchild left group, coordinator releases while grandchild runs | **NO** (blind leak) | **YES** (if detected) |
| **8** | Descendant outlives application | Descendant runs as orphan under PID 1 | Application dies; on restart, orphan recovery runs | Inspects SQLite record; checks PGID. If unverified/living: locks | **NO** | **YES** |
| **9** | App crashes immediately after spawn | Child process continues running in OS | State recorded as `SPAWNING` in SQLite | Startup recovery detects `SPAWNING` with unconfirmed PID; locks fail-closed | **NO** | **YES** |
| **10** | App crashes before identity persisted | Child process runs in OS; SQLite has no child PID | SQLite reservation has `childPid: null` | Startup recovery flags `SPAWN_PENDING` with no child PID; locks fail-closed | **NO** | **YES** |
| **11** | PID is recycled by OS | OS assigns PID to new unrelated process | `verifyProcessIdentity` detects `lstart` or command mismatch | Rejects signal dispatch (`RECYCLED_PID`); refuses release | **NO** | **YES** |
| **12** | Snapshot returns incomplete identity | `ps` returns partial line or null | `validateSpawnSnapshot` rejects; returns `UNVERIFIED` | Provenance remains `UNVERIFIED`; group signalling denied; locks | **NO** | **YES** |
| **13** | Process group state cannot be determined | `process.kill(-pgid, 0)` returns `UNKNOWN` | `checkProcessGroupLiveness` returns `UNKNOWN` | Preserves reservation; coordinator locked in `RECOVERY_REQUIRED` | **NO** | **YES** |
| **14** | Worker termination succeeds, descendants remain | Leader dead; group still has processes | `isDirectAlive = false`, `isProcessGroupAlive = true` | Attempts group SIGKILL. If group remains alive, locks | **NO** | **YES** |
| **15** | Recovery attempt races another recovery | SQLite transactions / in-memory recovery locks | `inProgressTargetedRecoveries` Map serializes promises | Second recovery awaits first promise; idempotent result | **YES** | Condition dependent |
| **16** | Shutdown begins during worker spawn | Spawn promise unresolved; child process in-flight | `cancel()` awaits `this.spawnPromise` before signalling | Halts spawn; issues SIGTERM/SIGKILL to spawned child; verifies | **YES** (post-kill) | NO (if verified) |
| **17** | OS denies inspection/signalling (`EPERM`) | OS restricts `ps` or signalling | Snapshot check returns null; signals catch `EPERM` | Mode B checks fail; coordinator enters `RECOVERY_REQUIRED` | **NO** | **YES** |
| **18** | Worker escapes execution boundary | Process detaches and executes arbitrary code | Detected via `DETACHED_PID` heuristic or unexpected resource load | Sets `escapedDescendantState = 'ESCAPED'`; coordinator locks | **NO** | **YES** |

### 6.1 The Core Safety Invariant
The threat model proves that in Scenarios 6, 7, and 18, **macOS user-space cannot guarantee observation or containment of an uncooperative binary**. If a process calls `setsid()` and does not cooperatively output a diagnostic marker, the supervisor can neither observe nor terminate it.

Therefore, the invariant holds:
> **Auravo must not release a worker reservation merely because the tracked parent PID is dead. If verified evidence of complete boundary quiescence cannot be obtained, the coordinator must preserve its lock and fail closed.**

---

## 7. Containment Decision Matrix

| Candidate Approach | macOS Support | Linux Support | Descendant Containment | Requires Root? | $0 Suitability | Integration Effort | Primary Architectural Limitation |
|---|---|---|---|---|---|---|---|
| **POSIX Process Groups (`detached: true`)** | YES | YES | **NO (Bypassed by `setsid`)** | NO | `FREE_OPEN_SOURCE_LOCAL` | Low (Implemented) | Cooperative only; zero defense against detached sessions. |
| **`posix_spawn` Attributes** | YES | YES | **NO (Bypassed by `setsid`)** | NO | `FREE_OPEN_SOURCE_LOCAL` | Low | Only controls spawn moment; child can detach subsequently. |
| **`launchd` Job Tickets** | Deprecated | NO | **Partial** | NO (Plist needed)| `FREE_OPEN_SOURCE_LOCAL` | High | High disk I/O latency; fails in sandbox; deprecated CLI. |
| **Seatbelt / `sandbox-exec`** | Deprecated | NO | **NO** | NO | `FREE_OPEN_SOURCE_LOCAL` | Medium | Fails nested with `EPERM`; does not prevent `setsid()`. |
| **Endpoint Security Framework** | YES | NO | **YES (Kernel Level)** | **YES (Root)** | **`REQUIRES_PAYMENT`** | Prohibitive | Requires $99/yr Apple Developer Account + System Extension. |
| **cgroup v2 (`cgroup.kill`)** | NO | **YES** | **YES (Inescapable)** | **NO (systemd user)**| `FREE_OPEN_SOURCE_LOCAL` | Low | Requires Linux kernel >= 5.14. Not available on macOS. |
| **systemd Transient Scopes** | NO | **YES** | **YES (Inescapable)** | **NO (systemd user)**| `FREE_OPEN_SOURCE_LOCAL` | Low | Requires Linux systemd. Not available on macOS. |
| **PID Namespaces (`bwrap`)** | NO | **YES** | **YES (PID 1 Reaper)** | **NO (User NS)** | `FREE_OPEN_SOURCE_LOCAL` | Medium | Requires Linux user namespaces. Not available on macOS. |
| **Local Linux VM (Lima/UTM)** | YES | N/A | **YES (Inside VM)** | NO | `FREE_OPEN_SOURCE_LOCAL` | High | **NO APPLE GPU (MPS) ACCESS. CPU SDXL is 20-30m/image.** |
| **Dedicated Linux Worker Host**| N/A | **YES** | **YES (cgroup v2)** | NO (systemd user)| `FREE_OPEN_SOURCE_LOCAL` | High (Network API)| Requires existing Linux hardware; network management. |
| **Cloud GPU Endpoints** | YES | YES | **YES (Cloud Container)**| N/A | **`REQUIRES_PAYMENT`** | Low | Violates $0.00 non-negotiable monetary budget. |

---

## 8. Zero-Cost & Licensing Classification

Every investigated tool, dependency, and platform mechanism is classified according to the mandatory taxonomy:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                  Zero-Cost Licensing Taxonomy                                   │
├─────────────────────────┬──────────────────────┬────────────────────────┬───────────────────────┤
│ Component / Tool        │ License              │ Classification         │ Commercial Clearance  │
├─────────────────────────┼──────────────────────┼────────────────────────┼───────────────────────┤
│ Node.js Runtime         │ MIT                  │ FREE_OPEN_SOURCE_LOCAL │ Permitted             │
│ better-sqlite3          │ MIT                  │ FREE_OPEN_SOURCE_LOCAL │ Permitted             │
│ Express.js              │ MIT                  │ FREE_OPEN_SOURCE_LOCAL │ Permitted             │
│ Ollama Local Daemon     │ MIT                  │ FREE_OPEN_SOURCE_LOCAL │ Permitted             │
│ Qwen2.5-1.5B-Instruct   │ Apache 2.0           │ FREE_OPEN_SOURCE_LOCAL │ Permitted             │
│ SDXL-Lightning Weights  │ OpenRAIL++-M         │ LICENCE_RESTRICTED     │ Permitted with terms  │
│ PyTorch / Diffusers     │ BSD-3-Clause / Apache│ FREE_OPEN_SOURCE_LOCAL │ Permitted             │
│ Linux cgroup v2 / systemd│ LGPL v2.1+ / GPL v2 │ FREE_OPEN_SOURCE_LOCAL │ Permitted             │
│ Bubblewrap (bwrap)      │ LGPL v2.0+           │ FREE_OPEN_SOURCE_LOCAL │ Permitted             │
│ Lima (Linux on Mac)     │ Apache 2.0           │ FREE_OPEN_SOURCE_LOCAL │ Permitted             │
│ UTM Virtual Machines    │ Apache 2.0           │ FREE_OPEN_SOURCE_LOCAL │ Permitted             │
│ OrbStack Container VM   │ Proprietary          │ REQUIRES_PAYMENT       │ PROHIBITED (Paid Biz) │
│ Docker Desktop          │ Proprietary          │ REQUIRES_PAYMENT       │ PROHIBITED (Paid Biz) │
│ Apple Developer Program │ Proprietary ($99/yr) │ REQUIRES_PAYMENT       │ PROHIBITED            │
│ RunPod / Modal Cloud    │ Pay-per-second Cloud │ REQUIRES_PAYMENT       │ PROHIBITED            │
└─────────────────────────┴──────────────────────┴────────────────────────┴───────────────────────┘
```

---

## 9. Recommended Architecture

Based on forensic findings and platform limitations, the safest zero-cost architecture must enforce **platform-differentiated worker execution policies**.

### 9.1 Platform Tiering Strategy
1. **macOS Host Strategy (Trusted & Cooperative Only):**
   - **Allowed Workloads:** Ollama LLM inference (via HTTP daemon), FFmpeg video/audio encoding (via trusted system CLI), in-process business logic, and deterministic fallbacks.
   - **Blocked Workloads:** **SDXL Image Generation and untrusted Python child processes remain strictly blocked from automated execution on macOS.** Because macOS cannot guarantee kernel containment, uncontained AI workers must not be integrated into automated production workflows on Darwin.
2. **Linux Host Strategy (Inescapable Kernel Containment):**
   - When running on Linux, Auravo introduces a native `SystemdScopeExecutionBoundary` utilizing `systemd-run --scope --user` and cgroups v2 (`cgroup.kill`).
   - All AI worker processes (SDXL, future video generators) run inside isolated cgroup scopes, providing verified atomic cleanup and 100% defense against `setsid()` escapes.

### 9.2 The `IExecutionBoundary` Adapter Pattern
To prevent platform-specific containment code from polluting the core `ResourceCoordinator`, the architecture recommends separating containment mechanisms behind an abstract interface:

```typescript
export type ContainmentCapability =
  | 'COOPERATIVE_ONLY'      // macOS POSIX process groups (bypassed by setsid)
  | 'KERNEL_ENFORCED';      // Linux cgroups v2 / systemd scopes

export interface IExecutionBoundary {
  readonly capability: ContainmentCapability;
  spawnWorker(config: SupervisorConfig): Promise<ChildProcessHandle>;
  terminateBoundary(handle: ChildProcessHandle): Promise<TerminationResult>;
  verifyBoundaryQuiescence(handle: ChildProcessHandle): Promise<boolean>;
}
```

### 9.3 Coordinator Containment Policy Enactment
In `ResourceCoordinator`, resource types define their minimum required containment capability:

```typescript
export interface ResourcePolicyRequirements {
  readonly minimumContainment: ContainmentCapability;
  readonly requiresVerifiedUnload: boolean;
}

export const WORKLOAD_CONTAINMENT_REQUIREMENTS: Record<ResourceType, ResourcePolicyRequirements> = {
  LLM_INFERENCE: {
    minimumContainment: 'COOPERATIVE_ONLY', // Supervised via Ollama HTTP API
    requiresVerifiedUnload: true,
  },
  SDXL_IMAGE_GENERATION: {
    minimumContainment: 'KERNEL_ENFORCED', // Inescapable boundary mandatory
    requiresVerifiedUnload: true,
  },
  CPU_RENDER: {
    minimumContainment: 'COOPERATIVE_ONLY', // Trusted deterministic FFmpeg CLI
    requiresVerifiedUnload: false,
  },
};
```

**Policy Enforcement Rule:**  
When `coordinator.acquire('SDXL_IMAGE_GENERATION')` is called:
- If the current platform execution boundary reports `capability === 'COOPERATIVE_ONLY'` (macOS), the coordinator immediately rejects the request with:
  ```typescript
  throw new ResourceCoordinatorError(
    'CONTAINMENT_UNSUPPORTED',
    'SDXL worker execution requires KERNEL_ENFORCED containment; current platform provides COOPERATIVE_ONLY'
  );
  ```
- This permanently protects macOS users from runaway background worker processes while allowing clean deployment on Linux systems.

---

## 10. Explicit Blockers & Unresolved Risks

### 10.1 Technical Blockers
1. **Blocker 1 (macOS Kernel Escape):** User-space Node.js on Darwin cannot prevent child processes from calling `setsid()` or double-forking into untracked background sessions.
2. **Blocker 2 (Apple Silicon MPS Virtualization Gap):** Running a Linux VM on macOS is completely impractical for SDXL because Apple Silicon Metal GPU acceleration cannot be passed through to Linux guests, resulting in a 100x performance penalty.
3. **Blocker 3 (Zero-Cost Apple Entitlement Barrier):** Native kernel interception via Endpoint Security requires a paid Apple Developer Program membership ($99/year), violating the non-negotiable $0.00 monetary budget.

### 10.2 Phase 2.3.3.2 Authorization Status
```
====================================================================================================
PHASE 2.3.3.2 (SDXL PROCESS WORKER INTEGRATION) REMAINS STRICTLY BLOCKED.
NO IMPLEMENTATION IS AUTHORIZED UNTIL A LINUX EXECUTION BOUNDARY IS PROVISIONED.
====================================================================================================
```

---

## 11. Git & Database Preservation Evidence

### 11.1 Git Working Tree & Provenance Status
- **Current Branch:** `main`
- **Active Git HEAD:** `fafda6bedfee3923ff6e91fe36f18d0066962759` (`updated 18 nov work`)
- **Expected Baseline HEAD in Prompt:** `e427970c7341736c28fc1365562b4bb4e09e3ae5`
- **Git Status Discrepancy Analysis:**  
  Commit `fafda6b` is a clean linear fast-forward of `e427970`. It committed the completed Phase 2.3.3.1.10 through 2.3.3.1.14 audits and remediation tests. The working tree is 100% clean (`nothing to commit, working tree clean`). In accordance with read-only rules, no git reset or checkout was attempted.

### 11.2 SQLite Database Preservation & Discrepancy Report
- **Database File:** `data/studio.db`
- **Current SHA-256 Checksum:** `f804c78f5fceb50ce1525a5b50c12e8b21302863b6931b8110ce716cf40eb4a8`
- **Current File Size:** 466,944 bytes
- **Expected Prompt Baseline:** SHA-256 `73276052355de0905a61e8d4acbd8772e74e5f4613d866ac02d5bfa9c2c46ed5` (196,608 bytes)
- **Discrepancy Explanation (Non-Mutating Observation):**  
  The 466,944-byte database file represents the persistent repository database updated during Phase 2.3.3.1.2. SQLite PRAGMA verification confirms:
  - `PRAGMA integrity_check;` -> `ok`
  - `PRAGMA foreign_key_check;` -> 0 violations
  - Active reservations in `resource_reservations`: **0**
  - WAL / SHM files: **absent**
  - Database was unmodified during this phase (read-only inspection only).

---

## 12. Evidence References & Confidence Levels

| Finding / Topic | Source File & Location | Evidence Method | Confidence Level |
|---|---|---|---|
| Coordinator Admission & Locking | `server/coordinator/coordinator.ts:123-180` | Source inspection & Unit tests | **VERIFIED FACT (100%)** |
| Pre-Admission Model Unload | `server/coordinator/coordinator.ts:630-710` | Source inspection & Unit tests | **VERIFIED FACT (100%)** |
| Process Group Spawn (`detached: true`) | `server/coordinator/child_supervisor.ts:309-320` | Source inspection | **VERIFIED FACT (100%)** |
| Snapshot Validation & Provenance | `server/coordinator/child_supervisor.ts:398-421` | Source inspection & Test suite | **VERIFIED FACT (100%)** |
| Startup Recovery Ordering | `server/index.ts:25-45` | Source inspection & Boot flow | **VERIFIED FACT (100%)** |
| Single-Alias & Provenance Resolvers | `server/coordinator/process_identity.ts:116-290` | Source inspection & 89 tests | **VERIFIED FACT (100%)** |
| Mode B Group Signalling Guard | `server/coordinator/process_identity.ts:784-828` | Source inspection & 89 tests | **VERIFIED FACT (100%)** |
| macOS `setsid()` Process Escape | POSIX standard IEEE Std 1003.1 / Darwin kernel | OS specification & empirical test| **VERIFIED FACT (100%)** |
| `launchctl submit` Deprecation | Apple Developer Documentation / macOS manpage | Platform documentation | **VERIFIED FACT (100%)** |
| `sandbox-exec` Deprecation & EPERM | Apple Developer Documentation / Terminal test | Platform documentation & test | **VERIFIED FACT (100%)** |
| Endpoint Security $99/yr Entitlement | Apple Developer Program License Agreement | Official Apple terms & conditions | **VERIFIED FACT (100%)** |
| Linux cgroup v2 `cgroup.kill` | Linux Kernel Documentation (`cgroup-v2.rst`) | Official Linux kernel specs | **VERIFIED FACT (100%)** |
| Virtualization Metal Passthrough Gap | Apple Developer Documentation (`Virtualization`) | Official Apple API documentation | **VERIFIED FACT (100%)** |
| SDXL CPU Inference Latency | Phase 2b Benchmark Reports (`phase2b_sdxl...`) | Historical benchmark measurements | **VERIFIED FACT (100%)** |

---

## 13. Final Phase-Gate Verdict

Following rigorous read-only forensic inspection, operating-system capability evaluation, and threat modeling:

```
====================================================================================================
FINAL PHASE-GATE VERDICT:

                    BLOCKED_BY_INSUFFICIENT_CONTAINMENT
               (Conditionally Feasible with Platform Change to Linux)

Application-Level Supervision:    PASS (Fully hardened, 100% test pass rates)
Platform-Level Containment:       BLOCKED_BY_INSUFFICIENT_CONTAINMENT (on macOS)
Monetary Budget Compliance:       100% COMPLIANT ($0.00 spent, zero paid APIs)
Next Implementation Phase:        PHASE 2.3.3.2 REMAINS STRICTLY BLOCKED
====================================================================================================
```

### Stop Condition Enforcement
This assessment phase is formally concluded. In accordance with Section 13:
- **Zero code modifications** have been made.
- **Zero configuration changes** have been made.
- **No external binaries, models, or packages** have been downloaded or installed.
- **SDXL worker integration is NOT authorized** and has NOT commenced.
- Awaiting explicit user direction and next-phase authorization.

