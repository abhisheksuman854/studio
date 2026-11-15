# Auravo Studio — Phase 2B.4: Controlled Prompt Correction & Tokenisation Audit Report

**Document ID:** `AURAVO-P2B4-AUDIT-20261114`  
**Date:** November 14, 2026  
**Status:** COMPLETE / AUDIT HALTED AT MANDATORY TOKEN CHECK  
**Classification:** Internal Engineering Audit  
**Phase:** 2B.4 (Prompt Correction & Tokenisation Audit)  
**Official Verdict:** `BLOCKED_BY_PROMPT_TRUNCATION`  

---

## 1. Executive Summary

Phase 2B.4 was initiated to evaluate whether correcting prompt semantics, removing polysemous terms (such as *"framed"*), eliminating negative terms from the positive prompt, and reordering descriptors could eliminate the composition anomalies (literal wooden frame, hands gripping border, and missing crimson costume) identified in Phase 2B.3 while preserving photographic facial realism on **Persona B** (a 29-year-old Latina professional dance performer).

In strict adherence to the **Phase 2B.4 Execution Specification (Section 7: Tokenisation Audit)**:
> *"5. Confirm that essential subject, composition and wardrobe descriptors are not silently truncated.*  
> *Do not assume that a universal 60-token limit applies identically to both text encoders.*  
> *If important descriptors are truncated, do not silently alter the prompt and proceed. Stop and report `BLOCKED_BY_PROMPT_TRUNCATION`."*

A rigorous tokenisation audit was executed across both loaded SDXL text encoders (**Tokenizer 1 / CLIP ViT-L/14** and **Tokenizer 2 / OpenCLIP ViT-bigG/14**) using the exact prompt provided. The audit revealed that:

1. **Severe Prompt Truncation:** The positive prompt contains **135 raw tokens** (137 including special tokens `<BOS>` and `<EOS>`). The strict hard ceiling for both SDXL text encoders is **77 tokens**.
2. **Total Loss of Intended Wardrobe:** The essential wardrobe descriptors—*`"elegant deep crimson satin dance costume clearly visible across the shoulders and neckline, tasteful fine gold embroidery on the costume"`*—reside between token indices **85 and 107**, which is **100% beyond the 77-token ceiling**. They are completely and silently dropped by the model.
3. **Loss of Lighting and Photographic Style:** Tokens 109 through 135 (*`"luxury fashion editorial photography, natural warm skin tones, soft professional studio lighting, realistic photographic depth of field, high-end portrait photography"`*) are also completely dropped.
4. **Negative Prompt Truncation:** The negative prompt contains 101 tokens and is truncated after token 77, silently discarding 24 negative tokens including `distorted facial features`, `blurry face`, `watermark`, `text`, and `logo`.

In compliance with the mandatory stop condition, model inference was **halted prior to UNet execution** to prevent invalid generation and token-waste. The pipeline, cache, and existing artifacts remain untouched.

---

## 2. Zero-Monetary-Cost Compliance Audit

| Requirement | Audit Criterion | Status | Evidence / Notes |
| :--- | :--- | :--- | :--- |
| **Monetary Cost** | $0.00 total spend | **PASSED** | 100% local on Apple Silicon M3 Pro (18 GB Unified Memory). |
| **External APIs** | Zero external API calls | **PASSED** | No OpenAI, Replicate, RunPod, or Fal.ai network calls. |
| **Model Downloads** | Zero weight downloads | **PASSED** | Loaded strictly from offline cache `~/.local/share/auravo/models/phase2b/cache/`. |
| **Dependencies** | No new pip/npm packages | **PASSED** | Reused existing isolated venv at `~/.local/share/auravo/venvs/phase2a/`. |
| **Application Integrity** | Zero git modifications | **PASSED** | Core application (`server/`, `client/`, database) completely untouched. |

---

## 3. Machine & Environment Preflight Verification

### 3.1 Hardware & Environment Audit
- **Machine:** Apple Mac15,6 (`Apple M3 Pro`, 18 GB Unified Memory).
- **Operating System:** macOS Darwin (ARM64).
- **Active Processes:** Confirmed **0 active Python inference or telemetry processes**.
- **Python Environment:** `/Users/abhisheksuman/.local/share/auravo/venvs/phase2a/bin/python` (Python 3.13.0).
- **Core Library Versions:**
  - `torch`: `2.15.0` (MPS available: `True`)
  - `diffusers`: `0.43.0`
  - `transformers`: `5.23.0`
  - `huggingface_hub`: `0.26.2`

### 3.2 Preflight Memory Snapshots (10-Second Interval Audit)
Per Requirement 3, three consecutive system memory snapshots separated by 10 seconds were captured before any model loading:

| Metric | Snapshot 1 ($t=0\text{s}$) | Snapshot 2 ($t=10\text{s}$) | Snapshot 3 ($t=20\text{s}$) | Status / Analysis |
| :--- | :---: | :---: | :---: | :--- |
| **Total Physical RAM** | 18.00 GB | 18.00 GB | 18.00 GB | Stable |
| **Available RAM** | 11.02 GB | 11.07 GB | 11.17 GB | **Sufficient (> 61% free)** |
| **RAM Utilization** | 38.8% | 38.5% | 38.0% | Normal |
| **Used Swap Memory** | 2,379.75 MB | 2,363.75 MB | 2,363.75 MB | **Stable & Recovered** |
| **Process RSS** | 214.28 MB | 214.36 MB | 214.36 MB | Idle |
| **MPS Allocated** | 0.00 MB | 0.00 MB | 0.00 MB | Idle |
| **MPS Driver Allocation** | 0.45 MB | 0.45 MB | 0.45 MB | Clean baseline |
| **Compressed Memory** | 0.30 GB | 0.31 GB | 0.31 GB | Minimal compression |
| **Memory Pressure Level** | Normal (1) | Normal (1) | Normal (1) | **Optimal / Green** |

#### Swap Recovery Investigation:
The audit confirmed that the elevated swap (~10.11 GB) recorded at the immediate conclusion of Phase 2B.3's CPU FP32 VAE decode has **successfully returned to a baseline of 2,363.75 MB (~2.3 GB)** during idle time. System memory pressure is completely green (`Normal (1)`), and available physical RAM is **11.17 GB**, confirming the host is stable and safe for execution.

---

## 4. Preservation of Previous Experiment Baselines

The historical experiment baselines were checked and their cryptographic hashes verified prior to execution:

| Artifact | File Path | Verified SHA-256 Checksum | Match |
| :--- | :--- | :--- | :---: |
| **Phase 2B.2 Persona B** | `~/.local/share/auravo/models/phase2b_2/outputs/persona_b_latin.png` | `37fcfcf602e257fb68285d68255d51a68df446041059110b8c6044faefd013ec` | **MATCH** |
| **Phase 2B.3 Bust-Framing** | `~/.local/share/auravo/models/phase2b_3/outputs/persona_b_bust_framing.png` | `90c0cc0b9dca3f68302a1343a129a6b8da0d8b58b088804049f57336769910f0` | **MATCH** |

Both files remain intact, unmodified, and preserved as read-only references.

---

## 5. Model Cache Offline Integrity

Offline local weights were verified in `~/.local/share/auravo/models/phase2b/cache/`:
- **ByteDance SDXL-Lightning 4-step UNet:** `sdxl_lightning_4step_unet.safetensors` (5,135,149,736 bytes / ~5.13 GB) — Verified present.
- **Stability AI SDXL Base 1.0 Snapshot:** `models--stabilityai--stable-diffusion-xl-base-1.0/snapshots/462165984030d82259a11f4367a4eed129e94a7b/` — Subfolders verified: `tokenizer`, `tokenizer_2`, `text_encoder`, `text_encoder_2`, `scheduler`, `vae`.

---

## 6. Mandatory Tokenisation & Truncation Audit

### 6.1 Prompts Evaluated
```text
POSITIVE PROMPT (Exact):
Photorealistic close-up beauty headshot portrait of an original fictional 29-year-old adult Latina professional dance performer, shoulders-up studio portrait, centered natural face, relaxed elegant head position, warm natural brown eyes with realistic catchlights, anatomically natural facial proportions, authentic human skin with subtle visible pores and fine natural skin texture, rich dark brown wavy hair with individually separated strands and delicate flyaway hairs, elegant deep crimson satin dance costume clearly visible across the shoulders and neckline, tasteful fine gold embroidery on the costume, luxury fashion editorial photography, natural warm skin tones, soft professional studio lighting, realistic photographic depth of field, high-end portrait photography.

NEGATIVE PROMPT (Exact):
picture frame, wooden frame, border, decorative border, hands, fingers, arms, wrists, forearms, visible limbs, extra fingers, missing fingers, fused fingers, malformed hands, deformed anatomy, extra limbs, anime, cartoon, illustration, digital painting, 3D render, CGI, doll, mannequin, plastic skin, wax face, artificial beauty filter, exaggerated eyes, unrealistic facial proportions, distorted facial features, blurry face, watermark, text, logo.
```

### 6.2 Token Counts & Limits by Text Encoder

Both SDXL text encoders have a hard maximum sequence length of **77 tokens** (including `<BOS>` at index 0 and `<EOS>` at index 76/77):

| Text Encoder Component | Raw Token Count | Encoded with Specials | Maximum Sequence Length | Truncation Status | Tokens Silently Dropped |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Tokenizer 1 (CLIP ViT-L/14)** | 135 | 137 | 77 | **TRUNCATED** | **60 tokens** |
| **Tokenizer 2 (OpenCLIP ViT-bigG/14)** | 135 | 137 | 77 | **TRUNCATED** | **60 tokens** |
| **Negative Prompt (Tokenizer 1)** | 99 | 101 | 77 | **TRUNCATED** | **24 tokens** |
| **Negative Prompt (Tokenizer 2)** | 99 | 101 | 77 | **TRUNCATED** | **24 tokens** |

### 6.3 Token Position Mapping & Truncation Analysis

| Semantic Category | Token Substring | Token Index Range | Position vs 77-Token Limit | Truncation Verdict |
| :--- | :--- | :---: | :---: | :--- |
| **Composition & Shot Type** | `photo realistic close-up beauty headshot portrait` | 1 – 8 | Within limit | Preserved |
| **Subject & Age** | `of an original fictional 29-year-old adult` | 9 – 19 | Within limit | Preserved |
| **Ethnicity & Role** | `latina professional dance performer` | 20 – 23 | Within limit | Preserved |
| **Secondary Framing** | `shoulders-up studio portrait` | 25 – 30 | Within limit | Preserved |
| **Face & Eyes** | `centered natural face ... warm natural brown eyes with realistic catch lights ... anatomically natural facial proportions` | 31 – 54 | Within limit | Preserved |
| **Skin Micro-Texture** | `authentic human skin with subtle visible pores and fine natural skin texture` | 55 – 68 | Within limit | Preserved |
| **Hair Description** | `rich dark brown wavy hair with individually separated` | 69 – 76 | Boundary | Preserved |
| **Hair Strands & Flyaways** | `strands and delicate flyaway hairs` | 77 – 83 | **Exceeds limit** | **TRUNCATED (Dropped)** |
| **Deep Crimson Costume** | `elegant deep crimson satin dance costume clearly visible across the shoulders and neckline` | **85 – 98** | **Exceeds limit** | **TRUNCATED (100% Dropped)** |
| **Gold Embroidery** | `tasteful fine gold embroidery on the costume` | **100 – 107** | **Exceeds limit** | **TRUNCATED (100% Dropped)** |
| **Photography & Lighting** | `luxury fashion editorial photography ... soft professional studio lighting ... realistic photographic depth of field` | **109 – 135** | **Exceeds limit** | **TRUNCATED (100% Dropped)** |

### 6.4 Kept vs Truncated Text Breakdown

- **Text Retained by the Model (Tokens 1 to 75):**
  > `Photorealistic close-up beauty headshot portrait of an original fictional 29-year-old adult Latina professional dance performer, shoulders-up studio portrait, centered natural face, relaxed elegant head position, warm natural brown eyes with realistic catchlights, anatomically natural facial proportions, authentic human skin with subtle visible pores and fine natural skin texture, rich dark brown wavy hair with individually separated`
- **Text Completely Discarded (Tokens 76 to 135):**
  > `strands and delicate flyaway hairs, elegant deep crimson satin dance costume clearly visible across the shoulders and neckline, tasteful fine gold embroidery on the costume, luxury fashion editorial photography, natural warm skin tones, soft professional studio lighting, realistic photographic depth of field, high-end portrait photography.`

---

## 7. Analysis of the Prompt Truncation Defect

### 7.1 Why This Explains the Phase 2B.3 Costume Failure
In Phase 2B.3, the prompt was 142 tokens long, and the crimson costume descriptor was placed at the end. As a result, the model never received any text conditioning regarding "crimson", "satin", or "gold embroidery", leading the UNet to default to a generic neutral tan crop top.

In the Phase 2B.4 prompt, despite removing words like "framed" and limb negations, extensive facial and skin descriptors pushed the wardrobe description from token index 85 onwards. Because both SDXL text encoders strictly truncate at token 77, **the exact same wardrobe failure would recur if inference were run**.

### 7.2 Why Inference Was Halted
The prompt instruction explicitly states:
> *"5. Confirm that essential subject, composition and wardrobe descriptors are not silently truncated.*  
> *Do not assume that a universal 60-token limit applies identically to both text encoders.*  
> *If important descriptors are truncated, do not silently alter the prompt and proceed. Stop and report `BLOCKED_BY_PROMPT_TRUNCATION`."*

Silently altering the prompt by reordering or shortening it without human review would violate the experimental protocol. Conversely, proceeding with inference knowing that the wardrobe descriptor is 100% truncated would waste compute on an invalid test that cannot satisfy the objective:
> *"The experiment must determine whether clearer positive prompting... can produce: The intended deep crimson dance costume with gold detailing."*

Therefore, halting with the official verdict `BLOCKED_BY_PROMPT_TRUNCATION` is the mathematically and procedurally correct action.

---

## 8. Preserved Telemetry & Artifact Files

The token audit data has been structured and persisted locally:
- **Token Audit JSON:** [`~/.local/share/auravo/models/phase2b_4/token_audit.json`](file:///Users/abhisheksuman/.local/share/auravo/models/phase2b_4/token_audit.json)
- **Phase 2B.4 Directory:** `~/.local/share/auravo/models/phase2b_4/`

---

## 9. Recommendations for Corrected Prompt Reordering

To successfully generate the portrait with both facial realism and the crimson costume in a subsequent run, the prompt must be reprioritized to place wardrobe and lighting within the first 75 tokens:

### Recommended Restructured Prompt (< 75 Tokens Total):
```text
Photorealistic close-up beauty headshot of an original fictional 29-year-old Latina dance performer, shoulders-up portrait, centered face, warm brown eyes, authentic skin texture with subtle pores, rich dark brown wavy hair, elegant deep crimson satin dance costume with fine gold embroidery across the neckline, luxury studio lighting.
```
*Token count: 54 tokens (fits completely within the 77-token ceiling of both encoders).*

---

## 10. Git Status & Repository Hygiene

The repository status was inspected and confirmed clean:
- Core application files (`server/`, `client/`, `web/`) and database schemas remain unmodified.
- No uncommitted binaries or temporary test images were committed.
- Work is strictly confined to audit reports in `docs/business-audit/` and local cache directories.

---

## 11. Official Verdict

```text
================================================================================
OFFICIAL PHASE 2B.4 VERDICT:
BLOCKED_BY_PROMPT_TRUNCATION
================================================================================
Reason: Both SDXL CLIP text encoders (ViT-L/14 and OpenCLIP ViT-bigG/14) enforce
a strict 77-token sequence ceiling. The proposed 135-token prompt positions all
essential wardrobe descriptors ("deep crimson satin dance costume", "gold embroidery")
at token indices 85 to 107, causing them to be 100% truncated and discarded.
Per Section 7, execution was halted prior to inference to prevent an invalid run.
================================================================================
```

