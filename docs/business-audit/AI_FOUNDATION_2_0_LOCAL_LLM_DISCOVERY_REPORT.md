# Auravo Studio — AI-Foundation 2.0: Local LLM Runtime Discovery, Model Licence Audit & Hardware Baseline Report

**Document ID:** `AURAVO-AIF2.0-DISCOVERY-20261116`  
**Phase:** AI-Foundation 2.0  
**Date:** November 16, 2026  
**Mode:** CONTROLLED ENVIRONMENT DISCOVERY AND READ-ONLY ARCHITECTURAL AUDIT  
**Repository:** `/Users/abhisheksuman/Documents/GitHub/studio`  
**Branch:** `main`  
**Baseline commit:** `b34e9ee6b10939de214dac8a3fb59ce13556d08b`  
**Final verdict:** `AI_FOUNDATION_2_0_READY_FOR_CONTROLLED_BENCHMARK`

---

## 1. Executive Summary

Phase AI-Foundation 2.0 evaluates the feasibility of integrating a genuine local language model runtime into Auravo Studio on the developer's Apple Silicon Mac at strictly zero monetary cost ($0.00).

Auravo's current `LocalLLMProvider` is a deterministic TypeScript template implementation. This audit establishes the architectural foundation, hardware memory constraints, model licensing boundaries, and integration mechanics required before any model weights are downloaded or runtime code is modified.

### Key Forensic Findings
1. **Verified Host Hardware**: Apple M3 Pro, 18 GB unified memory (19,327,352,832 bytes), 11 physical CPU cores (5 Performance cores, 6 Efficiency cores), Apple Metal GPU acceleration, 130 GiB available disk space, and 0.00 MB active swap usage.
2. **Pre-Existing Runtime Assets**: Ollama v0.18.2 (`/opt/homebrew/bin/ollama`) is already installed via Homebrew and actively running in the background as an idle local daemon (`127.0.0.1:11434`, PID 708, consuming only ~28.8 MB RSS). The Apple MLX C++ library (`mlx`, `mlx-c`) is also installed via Homebrew.
3. **Critical Licensing Discovery (The Qwen-3B License Trap)**:
   - While Qwen2.5-0.5B, 1.5B, and 7B are released under the commercially permissive **Apache 2.0** license, **Qwen2.5-3B-Instruct is released under the proprietary Qwen Research License Agreement (`qwen-research`), which explicitly prohibits commercial use without separate authorization from Alibaba**.
   - Qwen2.5-3B-Instruct is classified as **`LICENCE_RESTRICTED`** and **excluded from Auravo's commercial shortlist**.
4. **Viable Open-Source Models (Apache 2.0)**:
   - **Qwen2.5-1.5B-Instruct**: Permissive Apache 2.0, ~0.98 GB Q4_K_M GGUF, ~1.35 GB total loaded footprint at 4K context. Fits easily alongside background tasks with zero swap risk.
   - **Qwen2.5-7B-Instruct**: Permissive Apache 2.0, ~4.68 GB Q4_K_M GGUF, ~5.31 GB total loaded footprint at 4K context. High narrative quality, but must be scheduled sequentially with SDXL image generation.
   - **SmolLM2-1.7B-Instruct**: Permissive Apache 2.0, ~1.06 GB Q4_K_M GGUF, ~2.1 GB loaded footprint at 4K context (uses Multi-Head Attention, requiring larger KV cache than Qwen's Grouped Query Attention).
5. **Memory & SDXL Coexistence Rule**: Because Apple Silicon shares memory between CPU and GPU, running SDXL diffusion (~5.4 GB to 12.9 GB peak RSS) concurrently with an active LLM poses significant swapping risks. **Sequential execution (or on-demand model loading/unloading via `keep_alive: 0`) is mandatory**.
6. **Zero Monetary Cost ($0.00)**: All recommended runtimes (Ollama, llama.cpp, MLX) and models (Apache 2.0) are 100% free, open-source, and locally executed.

---

## 2. Verified Hardware & Host Environment Baseline

Measurements were captured directly from macOS system utilities (`sysctl`, `vm_stat`, `df`, `ps`):

| Hardware Attribute | Specification | Source / Command |
|---|---|---|
| **System Model** | Mac15,6 (MacBook Pro 14-inch) | `sysctl hw.model` |
| **SoC Processor** | Apple M3 Pro | `sysctl -n machdep.cpu.brand_string` |
| **CPU Topology** | 11 physical cores (5 Performance, 6 Efficiency) | `sysctl hw.perflevel0.physicalcpu hw.perflevel1.physicalcpu` |
| **Total Physical RAM** | 18 GB (19,327,352,832 bytes) | `sysctl hw.memsize` |
| **GPU Subsystem** | Apple Metal GPU (Unified Memory Architecture) | `system_profiler SPDisplaysDataType` |
| **Operating System** | macOS 26.0 (Build 25A354, Darwin 25.0.0) | `sw_vers` |
| **Memory Page Size** | 16,384 bytes (16 KB) | `vm_stat` |
| **Active Memory Usage** | 414,041 pages (~6.78 GB) | `vm_stat` |
| **Inactive Memory** | 377,039 pages (~6.17 GB, reclaimable) | `vm_stat` |
| **Wired Memory** | 148,418 pages (~2.43 GB) | `vm_stat` |
| **Compressor Occupied** | 118,649 pages (~1.94 GB) | `vm_stat` |
| **Swap Usage** | **0.00 MB total, 0.00 MB used** | `sysctl vm.swapusage` |
| **Root Disk Storage** | 460 GiB total, 17 GiB used, **130 GiB available** (12% capacity) | `df -h /` |
| **Xcode CLI Tools** | Installed (`/Applications/Xcode.app/Contents/Developer`) | `xcode-select -p` |
| **Apple Clang** | Version 17.0.0 (`clang-1700.3.19.1`, arm64-apple-darwin25.0.0) | `clang --version` |
| **Package Managers** | Homebrew (active in `/opt/homebrew/bin/brew`), `uv` 0.11.25 | `which brew`, `uv --version` |
| **System Python** | Python 3.14.8 (`/opt/homebrew/bin/python3`) | `python3 --version` |
| **ML Environment** | Isolated venv at `~/.local/share/auravo/venvs/phase2a` (Python 3.13.14, PyTorch 2.15.0 MPS, Diffusers 0.43.0, Transformers 5.23.0) | Verified via `pip list` |
| **Pre-installed LLM Runtime** | **Ollama v0.18.2** (`/opt/homebrew/bin/ollama`), active background daemon (PID 708, 28.8 MB RSS, listening on `127.0.0.1:11434`) | `ps aux`, `curl http://127.0.0.1:11434/` |

---

## 3. Runtime Candidate Evaluation

Four local inference architectures were evaluated for performance, licensing, installation footprint, and integration with Auravo's Node.js/TypeScript backend:

| Evaluation Criteria | Candidate A: `llama.cpp` | Candidate B: `Ollama` | Candidate C: `Apple MLX / MLX-LM` | Candidate D: `ONNX Runtime / WebAssembly` |
|---|---|---|---|---|
| **License** | MIT License | MIT License | MIT License | MIT / Apache 2.0 |
| **Cost Classification** | `FREE_OPEN_SOURCE_LOCAL` | `FREE_OPEN_SOURCE_LOCAL` | `FREE_OPEN_SOURCE_LOCAL` | `FREE_OPEN_SOURCE_LOCAL` |
| **Metal Acceleration** | Native GGML Metal backend (`ggml-metal.metal`) | Native Metal (wraps llama.cpp) | Native Apple Silicon Metal unified memory kernels | CoreML execution provider (mixed support) |
| **Installation Status** | Not compiled on host | **Already installed & running (v0.18.2)** | C++ library installed; Python package not in venv | Node packages available |
| **Host Footprint** | Standalone binary (~35 MB) | Single Homebrew binary (~50 MB) + model store | Python virtualenv dependency (~500 MB) | Node modules (~150 MB) |
| **Idle Memory RSS** | 0 MB (on-demand) or ~35 MB (server) | **~28.8 MB (active daemon PID 708)** | 0 MB (on-demand) | 0 MB (in-process) |
| **Model Format** | GGUF (all quantization levels) | GGUF / Ollama blobs | Safetensors (MLX 4-bit/8-bit format) | ONNX format |
| **Structured JSON Output** | Supported via GBNF grammar & JSON schema | **Supported natively (`format: "json"`)** | Supported via prompt & Outlines | Limited / brittle |
| **Model Lifecycle Control** | Subprocess start/stop or keep-alive flags | **`keep_alive: "0"` (immediate unload)** or `keep_alive: "5m"` | Python script memory management | V8 garbage collector (unreliable VRAM release) |
| **Integration Complexity** | Local HTTP REST API (`llama-server`) | **Local HTTP REST API (`127.0.0.1:11434`) via `fetch()`** | Requires Python IPC or Python microservice | In-process native binding |
| **Primary Limitation** | Requires compiling `llama-server` on host | Uses internal model namespace/blobs | Requires maintaining a second Python ML stack | Slow token generation, high V8 memory leak risk |

### Runtime Verdict
**Ollama is the recommended primary runtime for AI-Foundation 2.1**:
- It is **already installed** on the host machine (`/opt/homebrew/bin/ollama`, v0.18.2).
- The background daemon is **already running** safely on localhost (`127.0.0.1:11434`) with negligible idle memory (~28.8 MB).
- It provides native Metal acceleration, structured JSON enforcement (`format: "json"`), and OpenAI-compatible endpoints (`/v1/chat/completions`).
- It supports explicit model memory unloading via `keep_alive: "0"`, ensuring zero VRAM overlap with SDXL image generation.
- Integration with Auravo's Node.js backend requires **zero new npm dependencies**; it connects over standard native `fetch()`.

*`llama.cpp` (`llama-server`) remains the certified secondary fallback if fine-grained GBNF grammar or custom quantization tuning is required.*

---

## 4. Model Candidate & License Audit

A forensic review of model cards, copyright notices, and license terms was conducted across prominent small open-weight instruction models:

| Model Candidate | Parameters | License | Commercial Permissibility | Gated Access? | Attribution & Restrictions | Classification | Recommendation |
|---|:---:|---|:---:|:---:|---|:---:|:---:|
| **Qwen2.5-1.5B-Instruct** | 1.54B | **Apache 2.0** | **YES (Full)** | NO | Standard Apache 2.0 notice; state modifications. | `FREE_OPEN_SOURCE_LOCAL` | **PRIMARY SHORTLIST** |
| **Qwen2.5-3B-Instruct** | 3.09B | **Qwen Research License** (`qwen-research`) | **NO (Non-Commercial)** | NO | Strictly non-commercial research; commercial use requires explicit license from Alibaba Tongyi Lab. | **`LICENCE_RESTRICTED`** | **EXCLUDED (BLOCKED)** |
| **Qwen2.5-7B-Instruct** | 7.61B | **Apache 2.0** | **YES (Full)** | NO | Standard Apache 2.0 notice; state modifications. | `FREE_OPEN_SOURCE_LOCAL` | **SECONDARY (BENCHMARK)** |
| **SmolLM2-1.7B-Instruct** | 1.71B | **Apache 2.0** | **YES (Full)** | NO | Standard Apache 2.0 notice. Hugging Face TB. | `FREE_OPEN_SOURCE_LOCAL` | **SECONDARY SHORTLIST** |
| **Llama-3.2-1B-Instruct** | 1.23B | Llama 3.2 Community License | YES (Conditional) | **YES** | Meta gated click-through; <700M MAU limit; Meta Acceptable Use Policy. | `FREE_OPEN_SOURCE_LOCAL` | CONTINGENT ALTERNATIVE |
| **Llama-3.2-3B-Instruct** | 3.21B | Llama 3.2 Community License | YES (Conditional) | **YES** | Meta gated click-through; <700M MAU limit; Meta Acceptable Use Policy. | `FREE_OPEN_SOURCE_LOCAL` | CONTINGENT ALTERNATIVE |

### Critical Licensing Finding: The Qwen2.5-3B License Trap
In the Qwen2.5 release, Alibaba licensed the 0.5B, 1.5B, 7B, 14B, and 72B models under **Apache 2.0**. However, **Qwen2.5-3B is governed by the proprietary `Qwen Research License Agreement`**, which explicitly restricts usage to non-commercial research and evaluation. Claiming Qwen2.5-3B is Apache 2.0 would represent a severe legal compliance violation. It is strictly excluded from Auravo Studio.

---

## 5. Memory Budget & KV-Cache Analysis

### 5.1 Host Unified Memory Allocation Map (18 GB Total)
On Apple Silicon, CPU and GPU dynamically share the 18 GB physical memory pool:
- **macOS Core & System Daemons**: ~3.5 to 4.5 GB (wired + active system pages).
- **Auravo Node.js / TypeScript Server & SQLite**: ~0.25 GB RSS.
- **Safety Reclaimable Headroom**: ~2.0 GB (prevents memory compression and swap).
- **Usable Unified Memory for AI Workloads**: **~11.0 to 12.0 GB maximum**.

### 5.2 KV-Cache Math
KV cache memory per token is determined by:
$$\text{Memory per Token} = 2 \times \text{Layers} \times \text{KV Heads} \times \text{Head Dimension} \times \text{Bytes per Element (FP16 = 2)}$$

- **Qwen2.5-1.5B** ($28\text{ layers}, 2\text{ KV heads}, 128\text{ dim}$):
  $$2 \times 28 \times 2 \times 128 \times 2 = 28,672\text{ bytes/token} \approx 28.0\text{ KB/token}$$
  - $2,048\text{ context}$: $58.7\text{ MB}$
  - $4,096\text{ context}$: $117.4\text{ MB}$
  - $8,192\text{ context}$: $234.9\text{ MB}$
- **Qwen2.5-7B** ($28\text{ layers}, 4\text{ KV heads}, 128\text{ dim}$):
  $$2 \times 28 \times 4 \times 128 \times 2 = 57,344\text{ bytes/token} \approx 56.0\text{ KB/token}$$
  - $2,048\text{ context}$: $117.4\text{ MB}$
  - $4,096\text{ context}$: $234.9\text{ MB}$
  - $8,192\text{ context}$: $469.8\text{ MB}$
- **SmolLM2-1.7B** ($24\text{ layers}, 32\text{ KV heads (MHA)}, 64\text{ dim}$):
  $$2 \times 24 \times 32 \times 64 \times 2 = 196,608\text{ bytes/token} \approx 192.0\text{ KB/token}$$
  - $2,048\text{ context}$: $393.2\text{ MB}$
  - $4,096\text{ context}$: $786.4\text{ MB}$

### 5.3 Model Footprint & Runtime Overhead Comparison

| Model Candidate | Quantization | Download Size | Loaded Weights | KV Cache (4K Context) | Metal Buffers / Overhead | Total Active Memory | Headroom on 18 GB Mac |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Qwen2.5-1.5B** | **Q4_K_M** | **0.98 GB** | **1.02 GB** | **0.12 GB** | **0.25 GB** | **~1.39 GB** | **~10.5 GB (EXCELLENT)** |
| Qwen2.5-1.5B | Q5_K_M | 1.15 GB | 1.20 GB | 0.12 GB | 0.25 GB | ~1.57 GB | ~10.3 GB (EXCELLENT) |
| Qwen2.5-1.5B | Q8_0 | 1.65 GB | 1.72 GB | 0.12 GB | 0.25 GB | ~2.09 GB | ~9.8 GB (EXCELLENT) |
| SmolLM2-1.7B | Q4_K_M | 1.06 GB | 1.12 GB | 0.79 GB | 0.25 GB | ~2.16 GB | ~9.7 GB (GOOD) |
| **Qwen2.5-7B** | **Q4_K_M** | **4.68 GB** | **4.90 GB** | **0.23 GB** | **0.40 GB** | **~5.53 GB** | **~6.3 GB (MODERATE)** |
| Qwen2.5-7B | Q5_K_M | 5.40 GB | 5.65 GB | 0.23 GB | 0.40 GB | ~6.28 GB | ~5.6 GB (TIGHT) |

### 5.4 Coexistence Analysis with SDXL Diffusion
In Phase 2B.1–2B.5.4, local SDXL experiments recorded the following peak memory:
- **SDXL Base 1.0 + Lightning (4-step denoise)**: Peak RSS ~5,200 MB to 5,440 MB.
- **SDXL Native Img2Img (Phase 2B.5.3)**: Peak RSS ~12,957 MB, active swap 4,147 MB.
- **SDXL Masked Inpainting (Phase 2B.5.4)**: Peak RSS ~7,250 MB.

#### Coexistence Verdict:
1. **Concurrent Execution Prohibited**: Attempting to run SDXL diffusion simultaneously with an active 7B LLM ($5.5\text{ GB} + 7.25\text{ GB} + 4.5\text{ GB (system)} = 17.25\text{ GB}$) will trigger high memory pressure and aggressive disk paging.
2. **Qwen2.5-1.5B Coexistence Feasibility**: Because Qwen2.5-1.5B at Q4_K_M occupies only **~1.39 GB**, it can remain loaded in unified memory while SDXL 4-step generation executes ($1.39\text{ GB} + 5.4\text{ GB} + 4.5\text{ GB} \approx 11.29\text{ GB}$), staying well below the 18 GB ceiling with zero swap.
3. **Sequential Execution Protocol**: For 7B models, Ollama's `keep_alive: "0"` or an explicit unload command (`POST /api/generate {"model": "...", "keep_alive": 0}`) will be used to free unified memory before launching image diffusion jobs.

---

## 6. Tokenizer & Chat-Template Architecture

### 6.1 ChatML Template Structure (Qwen2.5)
Qwen2.5 models use the ChatML template format with dedicated special tokens:
```
<|im_start|>system
{system_prompt}<|im_end|>
<|im_start|>user
{user_prompt}<|im_end|>
<|im_start|>assistant
```
- **Special Tokens**: `<|im_start|>`, `<|im_end|>`, `<|endoftext|>`.
- **Vocabulary Size**: 152,064 tokens (TikToken-based BPE).
- **Enforcement**: When using Ollama's `/api/chat` or `/v1/chat/completions`, Ollama formats the ChatML template natively from the message objects array, eliminating token-injection vulnerabilities from manual string interpolation.

### 6.2 Structured JSON Schema Enforcement
For video scene planning and structured character profiles, Auravo requires strict JSON responses.
- **Ollama Native Mode**: Passing `format: "json"` in `POST /api/chat` forces the model's logits decoder to constrain output tokens to syntactically valid JSON.
- **TypeScript Application Validation**: The Node.js application will parse and validate the returned JSON string against strict TypeScript interfaces (`GeneratedStory`, `GeneratedStoryScene`) before committing records to SQLite.

---

## 7. Auravo Integration Architecture Proposal

### 7.1 Component Architecture
```
                                 [Client Browser]
                                        │ (HTTP / Session Cookie)
                                        ▼
                                 [server/app.ts]
                                        │
                                        ▼
                             [server/content_engine.ts]
                                        │
                      ┌─────────────────┴─────────────────┐
                      │                                   │
                      ▼                                   ▼
              [uid(req) verified]                [RAGEngine (db)]
                      │                                   │
                      ▼                                   ▼
             (userId propagated)                 (Tenant-Isolated Search)
                      │                                   │
                      └─────────────────┬─────────────────┘
                                        │
                                        ▼
                             [server/providers/llm.ts]
                                        │
                      ┌─────────────────┴─────────────────┐
                      ▼                                   ▼
             [OllamaLLMProvider]                 [LocalLLMProvider]
             (Real Local LLM)                   (Deterministic Fallback)
                      │                                   │
                      ▼ (fetch: 127.0.0.1:11434)          │
             [Ollama Daemon / Metal]                      │
                      │                                   │
                      └─────────────────┬─────────────────┘
                                        │
                                        ▼
                               [Structured Story]
```

### 7.2 Core Safeguards & Tenant Isolation Integrity
1. **Immutable Tenant Boundaries**:
   - `userId` is extracted exclusively from the authenticated session via `uid(req)`.
   - The LLM is **never** provided a mechanism or tool to specify, alter, or override `ownerId`.
   - Model-generated text is strictly treated as untrusted narrative data. It possesses **zero database query or modification authority**.
2. **Deterministic Fallback**:
   - If Ollama is offline, unreachable, times out, or returns invalid JSON, `OllamaLLMProvider` catches the error, logs a sanitized message, and immediately invokes `LocalLLMProvider` to fulfill the request with deterministic templates.
   - Studio functionality never halts due to an LLM service failure.
3. **Local Loopback Security**:
   - Ollama binds strictly to `127.0.0.1:11434`. No external network interfaces are exposed.
   - All prompt context, user notes, and character definitions remain strictly local on the user's SSD.

---

## 8. AI-Foundation 2.1 Benchmark & Evaluation Plan

The proposed evaluation suite for Phase 2.1 will be executed without downloading unapproved models or modifying application source code:

### 8.1 Measured Quantitative Metrics
- **Cold Load Latency**: Time to load model weights into unified memory from cold storage.
- **Time to First Token (TTFT)**: Latency from HTTP request dispatch to the arrival of the first generated token.
- **Generation Throughput**: Evaluated in tokens per second ($\text{tok/s}$).
- **Peak Process RSS & Host Memory Pressure**: Monitored via `psutil` and macOS `vm_stat` before, during, and after inference.
- **Swap Usage Delta**: Monitored via `sysctl vm.swapusage` (must remain 0.00 MB).
- **JSON Validity Rate**: Percentage of runs producing 100% syntactically valid JSON conforming to `GeneratedStory`.
- **Memory Recovery Latency**: Time required for unified memory to return to baseline after generation completes (`keep_alive: 0`).

### 8.2 Qualitative Evaluation Test Set (8 Standard Test Prompts)
1. **Original Character Profile**: Generate an authentic Indo-Classical Kathak dancer profile (personality, visual appearance, signature wardrobe tokens).
2. **Visual Prompt Tokenization**: Condense a character description into a high-density 60–75 token SDXL prompt without prompt truncation.
3. **Choreography Interpretation**: Interpret classical mudras and footwork patterns into vivid cinematic stage directions.
4. **5-Scene Story Generation**: Draft a complete 5-scene narrative (Hook, Development, Climax, Transition, Ending).
5. **Structured JSON Output**: Verify strict schema adherence matching Auravo's `GeneratedStory` TypeScript interface.
6. **RAG Knowledge Grounding**: Verify inclusion of retrieved authentic mudras from system default knowledge records.
7. **Tenant Isolation Containment**: Verify that User B's private knowledge is not accessible or injected into User A's prompt.
8. **Adversarial Prompt Injection**: Test resilience against prompt-injection jailbreaks attempting to output fake provenance keys or system commands.

---

## 9. Security, Privacy & Zero-Cost Compliance

### 9.1 Privacy & Security Boundaries
- **Zero External Network Calls**: Inference runs 100% offline on `127.0.0.1`. No prompts, character profiles, or private notes leave the machine.
- **No Agentic Tool Execution**: The model is restricted to pure text-to-text generation. It is not granted shell access, file read/write access, or database query tools.
- **Prompt Sanitization**: Untrusted user inputs and RAG context are safely framed inside ChatML system/user role blocks.

### 9.2 Mandatory Zero-Cost Compliance
- **Monetary Cost Incurred in Phase 2.0**: **$0.00**.
- **Model Weights Downloaded in Phase 2.0**: **0 bytes**.
- **Runtime Packages Installed in Phase 2.0**: **0 packages**.
- **Commercial Licensing Status**: Recommended models (`Qwen2.5-1.5B-Instruct`, `Qwen2.5-7B-Instruct`, `SmolLM2-1.7B-Instruct`) are licensed under **Apache 2.0**, ensuring full commercial freedom without royalty obligations.

---

## 10. Git Working Tree Comparison

### Pre-Discovery Baseline
- **HEAD Commit**: `b34e9ee6b10939de214dac8a3fb59ce13556d08b`
- **Tracked Modifications**: None from Phase 2.0 (pre-existing modifications from earlier phases preserved).

### Post-Discovery Status
- **Files Created**: Exactly 1 new report:
  `docs/business-audit/AI_FOUNDATION_2_0_LOCAL_LLM_DISCOVERY_REPORT.md`
- **Application Source Code**: **0 lines modified**.
- **Database Schema & Data**: **0 tables or rows modified**.
- **Dependencies (`package.json`)**: **0 dependencies added**.

---

## 11. Final Verdict & Next Steps

### Verdict: **`AI_FOUNDATION_2_0_READY_FOR_CONTROLLED_BENCHMARK`**

**Justification:**
1. Hardware capability on the Apple M3 Pro (18 GB unified memory, Metal acceleration) is confirmed capable of running 1.5B–7B models locally at zero monetary cost.
2. Ollama v0.18.2 is already installed and running on the host machine, eliminating the need to install or compile new runtime binaries.
3. The model licensing audit revealed the **Qwen2.5-3B non-commercial license trap**, successfully protecting the project from legal contamination, while validating **Qwen2.5-1.5B-Instruct** and **Qwen2.5-7B-Instruct** under permissive **Apache 2.0**.
4. Memory budgets and KV cache mathematics prove that **Qwen2.5-1.5B-Instruct (Q4_K_M)** requires only ~1.39 GB, allowing safe coexistence with background processes and zero disk swap.
5. The integration architecture and benchmark plan preserve Auravo's existing deterministic provider, RAG security, and tenant isolation without altering application code.

### Required Next Action
**STOP and await explicit user approval.**  
Do not download model weights or implement `OllamaLLMProvider` until the user reviews this discovery report and authorizes **Phase AI-Foundation 2.1 (Controlled Offline LLM Benchmark & Validation)**.

