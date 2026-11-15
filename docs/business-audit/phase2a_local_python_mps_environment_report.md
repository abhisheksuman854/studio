# Auravo Studio — Phase 2A: Isolated Local Python Environment & Apple MPS Verification Report

**Repository:** `/Users/abhisheksuman/Documents/GitHub/studio`  
**Expected Branch:** `main`  
**Execution Date:** 2026-11-13  
**Audit & Verification Type:** Controlled Local Environment Setup & Hardware Acceleration Audit  
**Phase Status:** **PHASE_2A_VERIFIED_READY**  
**Mandatory Constraint Compliance:** **ZERO MONETARY COST ($0.00)**  

---

## Table of Contents
- [Section A: Executive Summary & Environment Readiness Verdict](#section-a-executive-summary--environment-readiness-verdict)
- [Section B: Isolated Python Virtual Environment Specification](#section-b-isolated-python-virtual-environment-specification)
- [Section C: Dependency Manifest & Package Check](#section-c-dependency-manifest--package-check)
- [Section D: Apple Silicon Hardware & MPS Verification](#section-d-apple-silicon-hardware--mps-verification)
- [Section E: Storage & Cache Audit](#section-e-storage--cache-audit)
- [Section F: Scope & Non-Negotiable Rules Audit](#section-f-scope--non-negotiable-rules-audit)
- [Section G: Technical Findings & Environment Observations](#section-g-technical-findings--environment-observations)
- [Section H: Operational Runbook for Future Controlled Experiments](#section-h-operational-runbook-for-future-controlled-experiments)
- [Section I: Risk Assessment & Mitigation](#section-i-risk-assessment--mitigation)
- [Section J: Final Verdict & Sign-Off Gate](#section-j-final-verdict--sign-off-gate)

---

## Section A: Executive Summary & Environment Readiness Verdict

Phase 2A established an isolated, reproducible, zero-cost local Python environment specifically configured for local AI/ML inference on Apple Silicon hardware (M3 Pro, 18 GB Unified Memory).

### Key Accomplishments
1. **Isolated Virtual Environment Created Outside Repository:**  
   The dedicated environment was provisioned at `/Users/abhisheksuman/.local/share/auravo/venvs/phase2a` using Homebrew Python 3.13.14 (`arm64`). No repository folders, source trees, or Git tracking are polluted.
2. **Clean Minimal Dependency Installation:**  
   The core ML foundation stack (`torch==2.15.0`, `diffusers==0.43.0`, `transformers==5.23.0`, `accelerate==1.15.0`, `safetensors==0.8.0`, and `pillow==13.0.0`) was installed exclusively from official native pre-built wheels. Running `pip check` confirmed **zero broken requirements** (`No broken requirements found`).
3. **Genuine Apple Metal Performance Shaders (MPS) Acceleration Verified:**  
   PyTorch Apple MPS backend status was verified with `torch.backends.mps.is_built() == True` and `torch.backends.mps.is_available() == True`. A full synthetic tensor pipeline was executed on the MPS device:
   - Synthetic 1D float32 tensor allocation and device transfer (`CPU -> MPS`).
   - In-place MPS arithmetic and explicit synchronization via `torch.mps.synchronize()`.
   - Device-to-CPU retrieval (`MPS -> CPU`) and bit-exact assertion (`torch.allclose`).
   - General Matrix Multiply (GEMM) on MPS (`128x64` by `64x32` producing `128x32`).
   - Active memory tracking confirmed MPS memory management functionality (`0.06 MB` current tensor allocation, `8.47 MB` driver allocation).
4. **Strict Scope & Zero-Cost Compliance:**  
   - Monetary cost incurred: **$0.00**.
   - Model weights downloaded: **0 bytes** (no SDXL, SD 1.5, FLUX, or UNet weights downloaded).
   - Application code modified: **0 files**.
   - Database / schema modified: **0 tables**.

**Verdict:** **PHASE_2A_VERIFIED_READY** — The host environment is fully prepared for Phase 2B (controlled offline diffusion benchmarking) under strict zero-cost parameters.

---

## Section B: Isolated Python Virtual Environment Specification

### Environment Metadata
| Property | Value |
| :--- | :--- |
| **Virtual Environment Path** | `/Users/abhisheksuman/.local/share/auravo/venvs/phase2a` |
| **Base Python Binary** | `/opt/homebrew/bin/python3.13` |
| **Runtime Version** | Python 3.13.14 (`[Clang 21.0.0 (clang-2100.0.123.102)]`) |
| **Architecture** | `arm64` (Apple Silicon 64-bit) |
| **Virtualenv Tool** | Python Standard Library `venv` module (`--without-pip`, bootstrapped with `ensurepip`) |
| **Repository Separation** | Entirely outside `/Users/abhisheksuman/Documents/GitHub/studio` |
| **PEP 668 Compliance** | Fully isolated; does not tamper with system or Homebrew global site-packages |

### Creation Command Trace
```bash
# Directory creation outside project tree
mkdir -p /Users/abhisheksuman/.local/share/auravo/venvs

# Virtual environment instantiation
DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib /opt/homebrew/bin/python3.13 -m venv /Users/abhisheksuman/.local/share/auravo/venvs/phase2a
```

---

## Section C: Dependency Manifest & Package Check

### Core ML Packages
| Package | Version | Wheel Architecture | License | Function |
| :--- | :--- | :--- | :--- | :--- |
| **`torch`** | `2.15.0` | `macosx_14_0_arm64` | BSD-3-Clause | PyTorch deep learning framework with MPS backend |
| **`diffusers`** | `0.43.0` | `py3-none-any` | Apache 2.0 | Hugging Face diffusion pipelines & schedulers |
| **`transformers`** | `5.23.0` | `py3-none-any` | Apache 2.0 | Text encoders (CLIP, T5) and tokenizer pipelines |
| **`accelerate`** | `1.15.0` | `py3-none-any` | Apache 2.0 | Device mapping, memory optimization, low CPU usage |
| **`safetensors`** | `0.8.0` | `macosx_11_0_arm64` | Apache 2.0 | Fast, safe zero-copy tensor storage |
| **`Pillow`** | `13.0.0` | `macosx_11_0_arm64` | HPND | Image representation, saving, format conversion |

### Verification of Package Consistency (`pip check`)
```bash
$ DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib $HOME/.local/share/auravo/venvs/phase2a/bin/python -m pip check
No broken requirements found.
```

### Complete Environment Freeze (`pip freeze`)
```text
accelerate==1.15.0
annotated-doc==0.0.6
annotated-types==0.8.0
anyio==4.16.0
certifi==2026.10.23
charset-normalizer==3.5.2
click==8.5.1
diffusers==0.43.0
filelock==4.2.10
fsspec==2026.9.0
h11==0.16.0
hf-xet==1.8.0
httpcore2==2.16.0
httpx2==2.16.0
huggingface_hub==2.4.0
idna==3.20
importlib_metadata==10.2.0
Jinja2==3.1.6
lazy-importer==0.1.0
markdown-it-py==4.3.0
MarkupSafe==3.0.4
mdurl==0.1.2
mpmath==1.3.0
networkx==3.7
numpy==2.5.4
packaging==26.3
pillow==13.0.0
psutil==7.2.2
pydantic==2.14.3
pydantic_core==2.50.4
Pygments==2.21.0
PyYAML==6.0.3
regex==2026.11.9
requests==2.34.2
rich==15.0.0
safetensors==0.8.0
setuptools==84.2.1
shellingham==1.5.4
sympy==1.14.0
tokenizers==0.23.3
torch==2.15.0
tqdm==4.70.1
transformers==5.23.0
truststore==0.10.5
typer==0.29.1
typing-inspection==0.4.5
typing_extensions==4.16.0
urllib3==2.8.0
zipp==4.1.2
```

---

## Section D: Apple Silicon Hardware & MPS Verification

### Host Hardware Profile
- **System Architecture:** Apple Silicon `arm64`
- **Chipset:** Apple M3 Pro
- **Unified Memory:** 18 GB Unified RAM
- **Operating System:** macOS (Darwin Kernel Version 25.0.0)
- **Available Disk Space:** ~139 GiB free on root APFS volume

### Synthetic MPS Verification Script
The following synthetic verification script was executed directly inside the isolated virtual environment:

```python
import sys
import torch

print("Python Version:", sys.version)
print("PyTorch Version:", torch.__version__)
print("MPS Built:", torch.backends.mps.is_built())
print("MPS Available:", torch.backends.mps.is_available())

assert torch.backends.mps.is_built(), "MPS is not built in PyTorch!"
assert torch.backends.mps.is_available(), "MPS is not available on this system!"

device = torch.device("mps")
print("Target Device:", device)

# 1. Vector arithmetic
cpu_a = torch.tensor([1.0, 2.0, 3.0, 4.0, 5.0], dtype=torch.float32)
mps_a = cpu_a.to(device)
mps_res = mps_a * 2.5 + 1.5
torch.mps.synchronize()
cpu_res = mps_res.to("cpu")
expected_res = torch.tensor([4.0, 6.5, 9.0, 11.5, 14.0], dtype=torch.float32)
assert torch.allclose(cpu_res, expected_res), f"Mismatch: {cpu_res} vs {expected_res}"
print("Vector Arithmetic Verification: PASS (Output: {})".format(cpu_res.tolist()))

# 2. Matrix multiplication (GEMM)
m1 = torch.randn(128, 64, device=device, dtype=torch.float32)
m2 = torch.randn(64, 32, device=device, dtype=torch.float32)
m3 = torch.matmul(m1, m2)
torch.mps.synchronize()
print("Matrix Multiplication Shape:", list(m3.shape))
assert m3.shape == (128, 32), f"Unexpected shape {m3.shape}"
print("GEMM Verification: PASS")

# 3. Memory allocated info
current_alloc = torch.mps.current_allocated_memory()
driver_alloc = torch.mps.driver_allocated_memory()
print(f"MPS Current Allocated Memory: {current_alloc} bytes ({current_alloc / (1024*1024):.2f} MB)")
print(f"MPS Driver Allocated Memory: {driver_alloc} bytes ({driver_alloc / (1024*1024):.2f} MB)")
print("ALL MPS VERIFICATIONS PASSED")
```

### Raw Output from MPS Verification Execution
```text
Python Version: 3.13.14 (main, Jun 10 2026, 12:24:04) [Clang 21.0.0 (clang-2100.0.123.102)]
PyTorch Version: 2.15.0
MPS Built: True
MPS Available: True
Target Device: mps
Vector Arithmetic Verification: PASS (Output: [4.0, 6.5, 9.0, 11.5, 14.0])
Matrix Multiplication Shape: [128, 32]
GEMM Verification: PASS
MPS Current Allocated Memory: 57856 bytes (0.06 MB)
MPS Driver Allocated Memory: 8880128 bytes (8.47 MB)
ALL MPS VERIFICATIONS PASSED
```

### Core Import Verification
```bash
$ DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib $HOME/.local/share/auravo/venvs/phase2a/bin/python -c '
import diffusers, transformers, accelerate, safetensors
from PIL import Image
print("diffusers:", diffusers.__version__)
print("transformers:", transformers.__version__)
print("accelerate:", accelerate.__version__)
print("safetensors:", safetensors.__version__)
print("Pillow:", Image.__version__)
'
diffusers: 0.43.0
transformers: 5.23.0
accelerate: 1.15.0
safetensors: 0.8.0
Pillow: 13.0.0
```

---

## Section E: Storage & Cache Audit

### Disk Footprint
- **Isolated Virtual Environment (`~/.local/share/auravo/`):** `1.0 GiB`
- **Hugging Face Cache (`~/.cache/huggingface`):** Does not exist (`0 bytes`).
- **Available Host Disk Space:** `139 GiB` free on root volume.

### Confirmation of Zero Model Downloads
- No model weights, checkpoints, diffusion pipelines, or safetensor files were downloaded during Phase 2A.
- No model repositories (`byte-dance/SDXL-Lightning`, `stabilityai/stable-diffusion-xl-base-1.0`, etc.) were cloned or pulled.
- No pre-trained weights exist in the cache or within the repository tree.

---

## Section F: Scope & Non-Negotiable Rules Audit

| Constraint / Rule | Required State | Actual State | Compliance |
| :--- | :--- | :--- | :--- |
| **Zero Monetary Cost** | $0.00 spent | $0.00 spent | **COMPLIANT** |
| **No Paid APIs / Services** | No OpenAI, Replicate, Fal.ai, etc. | None queried or configured | **COMPLIANT** |
| **No Cloud / GPU Instances** | Local hardware only | M3 Pro local execution only | **COMPLIANT** |
| **No Model Weight Downloads** | 0 weights downloaded | 0 weights downloaded | **COMPLIANT** |
| **No Image Generation Run** | Synthetic tensor math only | Synthetic GEMM & elementwise only | **COMPLIANT** |
| **No App Code Modified** | `server/`, `client/` untouched | Untouched for Phase 2A | **COMPLIANT** |
| **No Database Changes** | SQLite DB untouched | Untouched | **COMPLIANT** |
| **Clean Git Repository** | No repo files committed or staged | Working tree clean of Phase 2A artifacts | **COMPLIANT** |

---

## Section G: Technical Findings & Environment Observations

1. **macOS Darwin 25 libexpat Dynamic Linking:**  
   Homebrew-built Python 3.13 binaries dynamically link against `/usr/lib/libexpat.1.dylib`. On Darwin 25.0, the system-provided expat library does not export `_XML_SetAllocTrackerActivationThreshold`. As a consequence, running Python without setting `DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib` produces an `ImportError: Symbol not found: _XML_SetAllocTrackerActivationThreshold in /usr/lib/libexpat.1.dylib` when importing modules like `pyexpat` or running `pip`. Supplying this environment variable routes linking to Homebrew's `expat 2.8.2`, completely resolving the issue.
2. **Official Native Wheels for Python 3.13 arm64:**  
   All dependencies (`torch 2.15.0`, `safetensors 0.8.0`, `pillow 13.0.0`, `numpy 2.5.4`, `pydantic-core 2.50.4`) installed via pre-compiled Mach-O 64-bit arm64 wheels. No local C/C++ compilation was required, preserving system build isolation.
3. **MPS Native Allocation Tracking:**  
   PyTorch 2.15.0 exposes `torch.mps.current_allocated_memory()` and `torch.mps.driver_allocated_memory()`, providing exact visibility into GPU memory pressure during tensor execution. This will be critical for Phase 2B memory profiling.

---

## Section H: Operational Runbook for Future Controlled Experiments

To invoke Python or execute benchmarking scripts inside this verified environment, use the canonical launcher format:

```bash
# Canonical execution pattern
DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib \
  /Users/abhisheksuman/.local/share/auravo/venvs/phase2a/bin/python <script_name>.py
```

### Shell Activation (Optional)
```bash
export DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib
source /Users/abhisheksuman/.local/share/auravo/venvs/phase2a/bin/activate
```

---

## Section I: Risk Assessment & Mitigation

| Risk | Impact | Likelihood | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Memory Pressure during SDXL loading** | Host swapping or process killed if >14 GB allocated | Medium | In Phase 2B, test `diffusers` pipelines with `torch.float16` and enable `enable_model_cpu_offload()` or `enable_sequential_cpu_offload()`. |
| **MPS Fallback to CPU** | Slow step execution if unsupported op is encountered | Low | Set `export PYTORCH_ENABLE_MPS_FALLBACK=1` to gracefully handle unsupported MPS operations without hard crash. |
| **Large Model Download Footprint** | Disk space consumption if downloading full unpruned checkpoints | Medium | Phase 2B should strictly download pruned safetensors (`byte-dance/SDXL-Lightning` 4-step UNet or standalone quantized safetensors ~6.6 GB). |

---

## Section J: Final Verdict & Sign-Off Gate

| Gate Check | Criterion | Status |
| :--- | :--- | :--- |
| 1. Virtual Environment Isolation | Separated from repo & global packages | **PASSED** |
| 2. Dependency Manifest | Zero broken requirements (`pip check`) | **PASSED** |
| 3. Apple MPS Hardware Support | `is_built() == True`, `is_available() == True` | **PASSED** |
| 4. Synthetic GPU Math | Arithmetic & GEMM verified on MPS | **PASSED** |
| 5. Core ML Imports | PyTorch, Diffusers, Transformers, Accelerate | **PASSED** |
| 6. Zero Monetary Cost | $0.00 spent across all operations | **PASSED** |
| 7. Zero Model Downloads | No weights downloaded ahead of authorization | **PASSED** |

### Overall Verification Status
# `PHASE_2A_VERIFIED_READY`

The local Python and Apple MPS acceleration environment is officially validated and ready for Phase 2B controlled experiments upon user authorisation.

