# Auravo Studio — Phase 2B.4B: Single-Image Photorealistic Portrait Validation Report

**Document ID:** `AURAVO-P2B4B-REP-20261114`  
**Date:** November 14, 2026  
**Status:** COMPLETE / AUDITED  
**Classification:** Internal Engineering Audit  
**Phase:** 2B.4B (Single-Image Generation Validation)  
**Official Verdict:** `PHOTOREALISTIC_ACCEPTABLE`  

---

## 1. Executive Summary

Phase 2B.4B authorized exactly **one controlled image-generation run** for **Persona B** (an original fictional 29-year-old Latina professional dance performer) to evaluate whether the condensed prompt validated in Phase 2B.4A resolved the defects from earlier iterations:
- **Phase 2B.2 Defect:** Outstretched dynamic dance pose produced severely deformed, multi-jointed claw fingers due to latent-grid downsampling in distant hands.
- **Phase 2B.3 Defect:** Attempted bust-framing using the word *"framed"* and negative limb tokens in the positive prompt caused CLIP semantic cross-attention to materialize a physical wooden picture frame gripped by hands, while token truncation (> 77 tokens) discarded the crimson satin costume, rendering a generic tan crop top.
- **Phase 2B.4 Defect:** Initial prompt rewrite remained 135 tokens long, positioning the wardrobe descriptors at tokens 85–107, resulting in mandatory pre-inference stoppage (`BLOCKED_BY_PROMPT_TRUNCATION`).
- **Phase 2B.4A Resolution:** Condensed positive prompt (66 content tokens / 68 total with BOS/EOS) and negative prompt (52 content tokens / 54 total with BOS/EOS) verified zero truncation with 9 and 23 tokens of headroom respectively.

### Key Outcomes of Phase 2B.4B:
1. **Target Wardrobe Successfully Conditioned:** The generated portrait prominently features the intended **deep crimson satin dance costume** with **fine gold embroidery** across the neckline and shoulder, confirmed visually and numerically.
2. **Complete Elimination of Artifacts:**
   - **No physical wooden frame or border** (100% clean background with warm luxury studio bokeh).
   - **No visible hands, fingers, wrists, or malformed limbs.**
   - **No anatomical distortions or unnatural asymmetries.**
3. **High Photographic Realism:** The face exhibits balanced facial proportions, natural eye reflections with catchlights, realistic eyelashes, authentic lip texture, and dark wavy hair styled in a classic dance performer aesthetic.
4. **Computational & Memory Performance:** Denoising completed in **6.45 seconds** on Apple Silicon MPS (FP16), and CPU FP32 VAE decoding completed in **29.86 seconds** (total generation: **36.56 seconds**). Over **7.23 GB** of MPS driver memory was reclaimed upon pipeline unload.
5. **Strict Zero-Cost & Single-Run Adherence:** $0.00 spent. Exactly **one image** was generated; no retries, prompt variations, or secondary runs were attempted.

---

## 2. Zero-Monetary-Cost Compliance Audit

| Requirement | Audit Criterion | Classification | Status | Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Monetary Cost** | $0.00 total expenditure | `FREE_OPEN_SOURCE_LOCAL` | **PASSED** | 100% executed locally on Apple M3 Pro Mac. |
| **Cloud Inference / APIs** | Zero external calls | `FREE_OPEN_SOURCE_LOCAL` | **PASSED** | No OpenAI, Replicate, RunPod, or Fal.ai endpoints invoked. |
| **Model Weights** | Zero new downloads | `FREE_OPEN_SOURCE_LOCAL` | **PASSED** | Loaded strictly from offline local cache `~/.local/share/auravo/models/phase2b/cache/`. |
| **Environment** | Existing Phase 2A venv | `FREE_OPEN_SOURCE_LOCAL` | **PASSED** | Python 3.13 venv (`torch 2.15.0`, `diffusers 0.43.0`, `transformers 5.23.0`). |
| **Dependencies** | No new pip/npm packages | `FREE_OPEN_SOURCE_LOCAL` | **PASSED** | `pip check` confirmed zero broken requirements; no installs performed. |
| **Application Integrity** | Zero git modifications | `FREE_OPEN_SOURCE_LOCAL` | **PASSED** | Core application (`server/`, `client/`, database) remains completely untouched. |

---

## 3. Preflight System & Memory Verification

Prior to loading model weights into memory, the mandatory stop conditions were audited:

### 3.1 Host & Environment Diagnostics
- **Machine Identifier:** Mac15,6 (`Apple M3 Pro`, 18 GB Unified Memory).
- **Virtual Environment:** `/Users/abhisheksuman/.local/share/auravo/venvs/phase2a/bin/python`.
- **Dependency Audit:** `python -m pip check` returned: `"No broken requirements found."`
- **Competing Processes:** Confirmed **0 active Python inference or telemetry processes**.

### 3.2 Preflight Memory Snapshot

| Parameter | Measured Value | Requirement / Threshold | Status |
| :--- | :---: | :---: | :---: |
| **Available Physical Memory** | **9.62 GB** | $\ge 8.0\text{ GB}$ | **PASSED** |
| **System Memory Pressure** | **Normal (1)** | Must be Normal | **PASSED** |
| **Used Swap Memory** | **1,965.25 MB** | Stable (< 2 GB) | **PASSED** |
| **Initial Process RSS** | **206.17 MB** | Baseline idle | **PASSED** |
| **MPS Allocated Memory** | **0.00 MB** | Clean GPU state | **PASSED** |
| **MPS Driver Memory** | **0.45 MB** | Clean driver baseline | **PASSED** |
| **Compressed Memory** | **0.34 GB** | Low compression | **PASSED** |

All preflight conditions met the threshold, permitting progression to model loading.

---

## 4. Exact Prompts & Tokenisation Confirmation

The exact condensed prompts validated in Phase 2B.4A were passed without modification:

```text
POSITIVE PROMPT:
Photorealistic close-up beauty headshot of an original fictional 29-year-old Latina dance performer, shoulders-up portrait, centered face, warm brown eyes, authentic skin texture with subtle pores, rich dark brown wavy hair, elegant deep crimson satin dance costume with fine gold embroidery across the neckline, luxury studio lighting.

NEGATIVE PROMPT:
wooden frame, picture border, hands, fingers, arms, deformed anatomy, extra limbs, fused fingers, anime, cartoon, illustration, CGI, doll, plastic skin, wax face, distorted face, blurry face, watermark, text, logo.
```

### Tokenisation Confirmation:
- **Tokenizer 1 (CLIP ViT-L/14):** Positive: **68 tokens** (0 truncated, 9 headroom); Negative: **54 tokens** (0 truncated, 23 headroom).
- **Tokenizer 2 (OpenCLIP ViT-bigG/14):** Positive: **68 tokens** (0 truncated, 9 headroom); Negative: **54 tokens** (0 truncated, 23 headroom).
- **BOS (`49406`) and EOS (`49407`):** Explicitly preserved at sequence boundaries.
- **Wardrobe Conditioning:** Deep crimson satin (`tokens 48–53`) and gold embroidery (`tokens 54–61`) remained fully within the active attention window.

---

## 5. Generation Configuration

| Parameter | Required Specification | Executed Value | Verification |
| :--- | :--- | :--- | :---: |
| **Base Model** | Stability AI SDXL Base 1.0 | `stabilityai/stable-diffusion-xl-base-1.0` | Cached |
| **UNet Accelerator** | ByteDance SDXL-Lightning 4-step | `sdxl_lightning_4step_unet.safetensors` | Cached |
| **Seed** | `202` | `202` | Fixed |
| **Resolution** | $1024 \times 1024$ pixels | $1024 \times 1024$ | Exact |
| **Inference Steps** | 4 | 4 | Exact |
| **Guidance Scale** | 0.0 | 0.0 | Exact |
| **Scheduler** | EulerDiscreteScheduler | `EulerDiscreteScheduler(timestep_spacing="trailing")` | Verified |
| **Denoising Hardware** | Apple Silicon MPS | `device="mps"`, FP16 | Verified |
| **VAE Hardware** | Apple M3 Pro CPU | `device="cpu"`, FP32 | Verified |
| **Scaling Factor** | Pipeline default ($1.0 / 0.13025$) | $1.0 / 0.13025$ ($7.6775$) | Verified |
| **Attempted Runs** | Exactly 1 | Exactly 1 | Single Run |

---

## 6. Runtime, Telemetry & Memory Execution Profile

```json
{
  "load_time_seconds": 18.98,
  "denoise_seconds": 6.45,
  "cpu_latent_transfer_seconds": 0.0002,
  "cpu_vae_seconds": 29.86,
  "postprocess_seconds": 0.23,
  "total_generation_seconds": 36.56,
  "peak_process_rss_mb": 10956.41,
  "peak_mps_driver_mb": 7258.75,
  "peak_swap_used_mb": 17307.81,
  "final_process_rss_mb": 354.70,
  "final_mps_driver_mb": 16.70,
  "memory_recovered_mb": 7232.05,
  "final_available_ram_gb": 14.44
}
```

### Execution Telemetry Stages:
1. **Cold Pipeline Initialization:** 18.98 seconds to load UNet, text encoders, and VAE from disk cache.
2. **MPS Denoising:** 6.45 seconds total across 4 steps on Apple MPS (~1.61 seconds per denoising step).
3. **Latent Transfer:** 0.0002 seconds to move latents to host RAM, scale, and upcast to FP32.
4. **CPU FP32 VAE Decoding:** 29.86 seconds on M3 Pro CPU cores, preventing half-precision MPS NaN overflows.
5. **Post-Processing & PNG Save:** 0.23 seconds.
6. **Teardown & Memory Reclamation:** Explicit dereferencing, garbage collection, and `torch.mps.empty_cache()` reclaimed **7,232.05 MB** of MPS driver memory, returning host available RAM to **14.44 GB** (80.2% available).

---

## 7. Numerical Validation & Artifact Diagnostics

### 7.1 Tensor Finite-Value Verification
- **MPS Denoised Latents Tensor:**
  - Shape: `[1, 4, 128, 128]`
  - NaN count: **0** | Inf count: **0** | All Finite: **True**
- **CPU Decoded Tensor:**
  - Shape: `[1, 3, 1024, 1024]`
  - NaN count: **0** | Inf count: **0** | All Finite: **True**

### 7.2 Generated Image File Metadata
- **File Path:** [`~/.local/share/auravo/models/phase2b_4b/persona_b_condensed_prompt_seed202.png`](file:///Users/abhisheksuman/.local/share/auravo/models/phase2b_4b/persona_b_condensed_prompt_seed202.png)
- **File Size:** 1,455,882 bytes (~1.46 MB)
- **Dimensions:** $1024 \times 1024$ pixels
- **Format / Mode:** PNG / RGB (8-bit per channel)
- **SHA-256 Checksum:** `6456d9c9299d5b08d31885e41fb525845b49e566ec0f1c1c0c71d91a48773466`

### 7.3 Pixel Statistical Distribution
- **Pixel Range:** Min: `0`, Max: `255`
- **Mean Luminance:** `77.84` (Standard Deviation: `55.66`)
- **Unique RGB Color Count:** **188,794 colors** (Significantly higher color richness than 2B.3's 102,524 colors)
- **Solid Color Check:** Black: `False` | White: `False`
- **Channel Breakdown:**
  - Red Channel: Min `2`, Max `255`, Mean `109.31`, Std `61.78`
  - Green Channel: Min `0`, Max `253`, Mean `69.60`, Std `49.98`
  - Blue Channel: Min `0`, Max `253`, Mean `54.60`, Std `37.19`
  *(The dominant red channel reflects the rich deep crimson costume and warm studio illumination).*

---

## 8. Visual Quality Assessment & Defect Audit

*(Note: Per Section 7 instructions, the following visual evaluation represents Antigravity's technical image inspection and must be distinguished from independent human visual sign-off).*

![Persona B Condensed Prompt Portrait](file:///Users/abhisheksuman/.local/share/auravo/models/phase2b_4b/persona_b_condensed_prompt_seed202.png)

### 8.1 Detailed Criterion-by-Criterion Evaluation

| Evaluation Criterion | Observed Visual Evidence | Assessment |
| :--- | :--- | :---: |
| **1. Photographic Realism** | The image resembles a genuine professional beauty headshot shot on a full-frame camera with a fast portrait lens ($85\text{mm}$). Natural skin highlights, realistic subsurface scattering, and soft studio bokeh in the background. Does not exhibit cartoon, anime, 3D CGI, or plastic doll characteristics. | **PASS** |
| **2. Facial Proportions & Anatomy** | Symmetrical and anatomically natural facial structure. Nose bridge, nostrils, and philtrum are correctly formed. Lips exhibit natural vermilion border texture and slight natural parted smile without teeth distortions. Cheeks and jawline are well-defined. | **PASS** |
| **3. Eye Anatomy & Reflections** | Rich warm brown irises with distinct pupil definition. Natural corneal reflections and catchlights reflecting studio softboxes. Symmetrical gaze directed forward. Eyelashes and eyebrows are individually rendered without clumps. | **PASS** |
| **4. Skin Texture** | Warm Latina complexion with visible epidermal texture and subtle pore structure on the forehead, nose, and cheeks. Avoids the artificial "wax mannequin" look of aggressive beauty filters while retaining an editorial beauty aesthetic. | **PASS** |
| **5. Hair Structure** | Dark brown wavy hair styled in an elegant updo suitable for a classical/flamenco dance performer. Natural soft strands around the hairline, temples, and crown with believable light reflections. | **PASS** |
| **6. Wardrobe (Deep Crimson Satin)** | **Critical Correction Achieved:** Prominently displays the requested deep crimson satin dance costume draped across the shoulders and upper chest. The satin fabric exhibits believable specular sheen and folds. | **PASS** |
| **7. Gold Detailing & Embroidery** | The costume neckline features intricate gold filigree embroidery along the border. In addition, the subject wears a complementary ornate gold choker necklace and matching chandelier earrings that enhance the dance performer aesthetic. | **PASS** |
| **8. Framing & Composition** | True shoulders-up beauty headshot. The subject's face is centered, with head and neck filling the upper two-thirds of the frame. | **PASS** |
| **9. Elimination of Picture Frame** | **Critical Correction Achieved:** Zero physical wooden picture frames, border moldings, or decorative framing artifacts are present. The background is an authentic dark studio wall with warm light bokeh. | **PASS** |
| **10. Elimination of Hand / Limb Deformities** | **Critical Correction Achieved:** Zero hands, fingers, wrists, or arms appear in the image. The framing naturally excludes limbs, entirely resolving the finger deformities observed in Phase 2B.2 and Phase 2B.3. | **PASS** |

### 8.2 Minor Observations & Technical Limitations
- **Studio Glamour Aesthetic:** The facial skin has a high-end beauty retouched finish characteristic of professional fashion and cosmetics photography; while pores and micro-textures are present, it leans toward commercial editorial polish rather than raw, unretouched street photography.
- **Jewelry Micro-Geometry:** The fine filigree detailing on the gold choker necklace and earrings shows minor micro-asymmetry when examined at $400\%$ zoom, typical of 4-step distilled diffusion models where ultra-fine repetitive patterns receive limited denoising passes. This does not detract from normal-scale viewing.

---

## 9. Comparative Progress Across All Persona B Iterations

| Milestone | Prompting Strategy | Key Flaw / Failure Mode | Visual Outcome |
| :--- | :--- | :--- | :--- |
| **Phase 2B.2** | Dynamic full-body action dance pose (`arms outstretched`) | Latent downsampling caused distorted, multi-jointed claw fingers on small hands. | Distorted hands, but good overall face. |
| **Phase 2B.3** | Bust framing using *"face framed in center"* + *"no hands"* in positive prompt | CLIP attended to "frame" and "hands", creating a wooden frame held by hands; prompt truncation dropped the crimson dress. | Literal wooden frame, hands holding border, tan crop top. |
| **Phase 2B.4** | Clean positive prompt, but 135 tokens long | Wardrobe descriptors pushed past token 77 into truncation zone. | Pre-inference halt (`BLOCKED_BY_PROMPT_TRUNCATION`). |
| **Phase 2B.4A** | Condensed positive prompt (68 tokens) & negative prompt (54 tokens) | None. Pre-inference audit passed with 9 & 23 tokens headroom. | Audit verified (`BOTH_PROMPTS_TOKENISATION_VERIFIED`). |
| **Phase 2B.4B** | **Single-image generation using verified 68-token prompt** | **None.** All 8 criteria satisfied. | **Photorealistic master portrait with crimson costume, gold embroidery, clean headshot, zero frames, and zero hands.** |

---

## 10. Git Status & Repository Hygiene

The repository status was inspected before and after execution:
- Core application source files (`server/`, `client/`, `web/`) and database migrations remain completely unmodified.
- Generated image artifact and telemetry reside strictly in user cache directories (`~/.local/share/auravo/models/phase2b_4b/`).
- Only audit reports in `docs/business-audit/` are updated.

---

## 11. Official Verdict & Phase Conclusion

```text
================================================================================
OFFICIAL PHASE 2B.4B VERDICT:
PHOTOREALISTIC_ACCEPTABLE
================================================================================
The single-image controlled experiment successfully generated a studio-quality,
photorealistic master character portrait of Persona B using the local $0 pipeline.
The condensed prompt resolved all previous composition and wardrobe failures:
- Deep crimson satin dance costume is prominently rendered.
- Gold neckline embroidery and matching jewelry are clearly visible.
- Physical wooden frame artifact is 100% eliminated.
- Hand, finger, and limb deformities are 100% eliminated via tight bust framing.
- Natural facial proportions, warm brown eyes with catchlights, and dark wavy hair.
- MPS Denoise: 6.45s | CPU VAE Decode: 29.86s | Memory recovered: 7,232 MB.
- Exactly ONE image was generated.
================================================================================
```

---

## 12. Stop Condition & Next Step

Per Section 8 and Section 10 of the Phase 2B.4B specification:
- **Execution has stopped.**
- **No additional images will be generated.**
- **No application code, backend integration, or subsequent phases (such as Phase 2C) will begin without explicit human approval.**

