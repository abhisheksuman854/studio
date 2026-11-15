# Auravo Studio — Phase 2B.4A: Condensed Prompt Tokenisation Validation Report

**Document ID:** `AURAVO-P2B4A-AUDIT-20261114`  
**Date:** November 14, 2026  
**Status:** COMPLETE / AUDIT VERIFIED  
**Classification:** Internal Engineering Audit  
**Phase:** 2B.4A (Pre-Inference Prompt Tokenisation Validation)  
**Official Verdict:** `BOTH_PROMPTS_TOKENISATION_VERIFIED`  

---

## 1. Executive Summary

Phase 2B.4A was conducted as a strict pre-inference tokenisation audit to validate whether the proposed condensed positive and negative prompt candidates for **Persona B** (a 29-year-old Latina professional dance performer) fit completely within the hard sequence boundaries of both SDXL text tokenizers without truncation or information loss.

In the preceding Phase 2B.4 audit, the initial 135-token prompt placed the critical wardrobe descriptors (*`"deep crimson satin dance costume"`, `"gold embroidery"`*) between tokens 85 and 107, leading to total truncation and halting execution under the verdict `BLOCKED_BY_PROMPT_TRUNCATION`.

In Phase 2B.4A, both prompt candidates were evaluated across the actual local offline tokenizers:
1. **Tokenizer 1:** CLIP ViT-L/14 (`stabilityai/stable-diffusion-xl-base-1.0/tokenizer`)
2. **Tokenizer 2:** OpenCLIP ViT-bigG/14 (`stabilityai/stable-diffusion-xl-base-1.0/tokenizer_2`)

### Key Audit Results:
- **Positive Prompt:** Consumes **66 content tokens** (68 total tokens including special `<|startoftext|>` at position 0 and `<|endoftext|>` at position 67). It fits comfortably within the 77-token ceiling with **9 tokens of headroom** (and satisfies the conservative 75 content-token threshold). **Zero truncation occurred.**
- **Negative Prompt:** Consumes **52 content tokens** (54 total tokens including special `<|startoftext|>` at position 0 and `<|endoftext|>` at position 53). It fits well within the 77-token ceiling with **23 tokens of headroom**. **Zero truncation occurred.**
- **Descriptor Integrity:** Every essential positive descriptor—including the subject identity, ethnicity, portrait framing, facial proportions, skin micro-pores, wavy hair, deep crimson satin costume, neckline gold embroidery, and studio lighting—is 100% retained and positioned well within the active attention window.
- **Negative Constraint Integrity:** All negative constraints—including wooden frame, picture border, hands, fingers, arms, deformed anatomy, extra limbs, fused fingers, CGI/doll styles, and facial distortions—are 100% retained.
- **Zero-Inference Stop Condition Enforced:** **No UNet inference or VAE decoding was executed.** The host environment, model weights, and application codebase remain completely unmodified.

---

## 2. Zero-Monetary-Cost Compliance Audit

| Requirement | Audit Criterion | Status | Evidence / Notes |
| :--- | :--- | :--- | :--- |
| **Monetary Cost** | $0.00 total spend | **PASSED** | 100% local on Apple Silicon M3 Pro (18 GB Unified Memory). |
| **External APIs** | Zero external API calls | **PASSED** | No OpenAI, Replicate, RunPod, or Fal.ai network calls. |
| **Model Downloads** | Zero weight downloads | **PASSED** | Evaluated cached tokenizer files offline. |
| **Dependencies** | No new pip/npm packages | **PASSED** | Reused existing isolated venv at `~/.local/share/auravo/venvs/phase2a/`. |
| **Application Integrity** | Zero git modifications | **PASSED** | Core application (`server/`, `client/`, database) completely untouched. |
| **Compute Safety** | Zero model inference | **PASSED** | Tokenizer-only audit; UNet/VAE never instantiated. |

---

## 3. Exact Evaluated Prompt Candidates

### 3.1 Positive Prompt Candidate
```text
Photorealistic close-up beauty headshot of an original fictional 29-year-old Latina dance performer, shoulders-up portrait, centered face, warm brown eyes, authentic skin texture with subtle pores, rich dark brown wavy hair, elegant deep crimson satin dance costume with fine gold embroidery across the neckline, luxury studio lighting.
```

### 3.2 Negative Prompt Candidate
```text
wooden frame, picture border, hands, fingers, arms, deformed anatomy, extra limbs, fused fingers, anime, cartoon, illustration, CGI, doll, plastic skin, wax face, distorted face, blurry face, watermark, text, logo.
```

---

## 4. Tokenizer Specifications & Sequence Limits

| Property | Tokenizer 1 | Tokenizer 2 | Match |
| :--- | :--- | :--- | :---: |
| **Architecture** | CLIP ViT-L/14 | OpenCLIP ViT-bigG/14 | Architecture Pair |
| **Source Location** | `.../snapshots/462165984030d82259a11f4367a4eed129e94a7b/tokenizer` | `.../snapshots/462165984030d82259a11f4367a4eed129e94a7b/tokenizer_2` | Offline Cache |
| **BOS Token ID** | `49406` (`<|startoftext|>`) | `49406` (`<|startoftext|>`) | **IDENTICAL** |
| **EOS Token ID** | `49407` (`<|endoftext|>`) | `49407` (`<|endoftext|>`) | **IDENTICAL** |
| **Maximum Sequence Length** | 77 | 77 | **IDENTICAL** |
| **Conservative Content Limit** | 75 content tokens | 75 content tokens | **IDENTICAL** |

---

## 5. Token-by-Token Sequence Analysis

### 5.1 Positive Prompt Token Breakdown

Both tokenizers produced identical token streams across all 68 positions:

| Index | Token ID | BPE Token String | Semantic Mapping | Status |
| :---: | :---: | :--- | :--- | :---: |
| **0** | `49406` | `<|startoftext|>` | Sequence Start (BOS) | **PRESERVED** |
| **1** | `1153` | `photo` | Composition / Photographic | Active |
| **2** | `16157` | `realistic</w>` | Realism style | Active |
| **3** | `2660` | `close</w>` | Composition / Shot Type | Active |
| **4** | `268` | `-</w>` | Hyphen | Active |
| **5** | `705` | `up</w>` | Composition / Shot Type | Active |
| **6** | `2488` | `beauty</w>` | Aesthetic | Active |
| **7** | `34890` | `headshot</w>` | Framing type | Active |
| **8** | `539` | `of</w>` | Grammar | Active |
| **9** | `550` | `an</w>` | Grammar | Active |
| **10** | `3117` | `original</w>` | Subject provenance | Active |
| **11** | `25570` | `fictional</w>` | Fictional persona constraint | Active |
| **12** | `273` | `2</w>` | Age descriptor ("29") | Active |
| **13** | `280` | `9</w>` | Age descriptor ("29") | Active |
| **14** | `268` | `-</w>` | Hyphen | Active |
| **15** | `935` | `year</w>` | Age unit | Active |
| **16** | `268` | `-</w>` | Hyphen | Active |
| **17** | `896` | `old</w>` | Age descriptor | Active |
| **18** | `27936` | `latina</w>` | Ethnic identity | Active |
| **19** | `2724` | `dance</w>` | Profession | Active |
| **20** | `17061` | `performer</w>` | Profession | Active |
| **21** | `267` | `,</w>` | Delimiter | Active |
| **22** | `18738` | `shoulders</w>` | Framing ("shoulders-up") | Active |
| **23** | `268` | `-</w>` | Hyphen | Active |
| **24** | `705` | `up</w>` | Framing ("shoulders-up") | Active |
| **25** | `5352` | `portrait</w>` | Shot type | Active |
| **26** | `267` | `,</w>` | Delimiter | Active |
| **27** | `24584` | `centered</w>` | Facial positioning | Active |
| **28** | `1710` | `face</w>` | Facial positioning | Active |
| **29** | `267` | `,</w>` | Delimiter | Active |
| **30** | `3616` | `warm</w>` | Eye color / warmth | Active |
| **31** | `2866` | `brown</w>` | Eye color | Active |
| **32** | `3095` | `eyes</w>` | Anatomy | Active |
| **33** | `267` | `,</w>` | Delimiter | Active |
| **34** | `10369` | `authentic</w>` | Skin authenticity | Active |
| **35** | `3575` | `skin</w>` | Skin texture | Active |
| **36** | `16505` | `texture</w>` | Skin texture | Active |
| **37** | `593` | `with</w>` | Grammar | Active |
| **38** | `16536` | `subtle</w>` | Pore subtlety | Active |
| **39** | `628` | `po` | Pore anatomy ("pores") | Active |
| **40** | `934` | `res</w>` | Pore anatomy ("pores") | Active |
| **41** | `267` | `,</w>` | Delimiter | Active |
| **42** | `4021` | `rich</w>` | Hair aesthetic | Active |
| **43** | `3144` | `dark</w>` | Hair color | Active |
| **44** | `2866` | `brown</w>` | Hair color | Active |
| **45** | `31941` | `wavy</w>` | Hair texture | Active |
| **46** | `2225` | `hair</w>` | Hair anatomy | Active |
| **47** | `267` | `,</w>` | Delimiter | Active |
| **48** | `11124` | `elegant</w>` | Costume aesthetic | Active |
| **49** | `3383` | `deep</w>` | Costume color shade | Active |
| **50** | `19437` | `crimson</w>` | **Costume Color (CRIMSON)** | **Active (Preserved)** |
| **51** | `21803` | `satin</w>` | **Costume Fabric (SATIN)** | **Active (Preserved)** |
| **52** | `2724` | `dance</w>` | Costume type | Active |
| **53** | `7235` | `costume</w>` | Wardrobe item | Active |
| **54** | `593` | `with</w>` | Grammar | Active |
| **55** | `3797` | `fine</w>` | Embroidery detailing | Active |
| **56** | `2209` | `gold</w>` | **Embroidery Color (GOLD)** | **Active (Preserved)** |
| **57** | `20823` | `embroidery</w>` | **Embroidery Detailing** | **Active (Preserved)** |
| **58** | `2500` | `across</w>` | Placement | Active |
| **59** | `518` | `the</w>` | Grammar | Active |
| **60** | `6066` | `neck` | Neckline placement | Active |
| **61** | `1148` | `line</w>` | Neckline placement | Active |
| **62** | `267` | `,</w>` | Delimiter | Active |
| **63** | `5247` | `luxury</w>` | Lighting quality | Active |
| **64** | `3155` | `studio</w>` | Lighting environment | Active |
| **65** | `5799` | `lighting</w>` | Lighting environment | Active |
| **66** | `269` | `.</w>` | Punctuation | Active |
| **67** | `49407` | `<|endoftext|>` | Sequence End (EOS) | **PRESERVED** |

**Summary Statistics:**
- Total Encoded Length: **68 tokens**
- Headroom below 77 limit: **9 tokens**
- Content Tokens: **66 tokens** ($\le 75$ threshold satisfied)
- Retained Text: 100% (Identical to raw input string)
- Discarded Text: **0 tokens**

---

### 5.2 Negative Prompt Token Breakdown

Both tokenizers produced identical token streams across all 54 positions:

| Index | Token ID | BPE Token String | Target Negative Restriction | Status |
| :---: | :---: | :--- | :--- | :---: |
| **0** | `49406` | `<|startoftext|>` | Sequence Start (BOS) | **PRESERVED** |
| **1 – 2** | `9057`, `6481` | `wooden frame` | Physical frame artifact exclusion | Active |
| **3** | `267` | `,` | Delimiter | Active |
| **4 – 5** | `1674`, `6177` | `picture border` | Picture border exclusion | Active |
| **6** | `267` | `,` | Delimiter | Active |
| **7** | `3500` | `hands` | **Hand anatomy exclusion** | **Active** |
| **8** | `267` | `,` | Delimiter | Active |
| **9** | `9690` | `fingers` | **Finger anatomy exclusion** | **Active** |
| **10** | `267` | `,` | Delimiter | Active |
| **11** | `5706` | `arms` | **Arm anatomy exclusion** | **Active** |
| **12** | `267` | `,` | Delimiter | Active |
| **13 – 15** | `561`, `6528`, `15376` | `de formed anatomy` | Anatomical defect exclusion | Active |
| **16** | `267` | `,` | Delimiter | Active |
| **17 – 18** | `4231`, `34886` | `extra limbs` | Limb defect exclusion | Active |
| **19** | `267` | `,` | Delimiter | Active |
| **20 – 21** | `38994`, `9690` | `fused fingers` | Finger defect exclusion | Active |
| **22** | `267` | `,` | Delimiter | Active |
| **23 – 31** | `6469`, ..., `9286` | `anime, cartoon, illustration, cgi, doll` | Non-photographic style exclusion | Active |
| **32** | `267` | `,` | Delimiter | Active |
| **33 – 37** | `6102`, ..., `1710` | `plastic skin, wax face` | Synthetic skin artifact exclusion | Active |
| **38** | `267` | `,` | Delimiter | Active |
| **39 – 44** | `23781`, ..., `1710` | `distorted face, blurry face` | Facial distortion exclusion | Active |
| **45** | `267` | `,` | Delimiter | Active |
| **46 – 51** | `2505`, ..., `5750` | `watermark, text, logo` | Watermark & logo exclusion | Active |
| **52** | `269` | `.` | Punctuation | Active |
| **53** | `49407` | `<|endoftext|>` | Sequence End (EOS) | **PRESERVED** |

**Summary Statistics:**
- Total Encoded Length: **54 tokens**
- Headroom below 77 limit: **23 tokens**
- Content Tokens: **52 tokens** ($\le 75$ threshold satisfied)
- Retained Text: 100% (Identical to raw input string)
- Discarded Text: **0 tokens**

---

## 6. Semantic Category Mapping Verification

| Semantic Category | Tokens / Positions | Content Tokens | Position Relative to Ceiling | Integrity Status |
| :--- | :---: | :---: | :---: | :---: |
| **Original fictional adult subject** | Indices 8 – 17 | 10 | $8 \le \text{pos} \le 17 \ll 77$ | **100% Preserved** |
| **Latina identity & performer** | Indices 18 – 20 | 3 | $18 \le \text{pos} \le 20 \ll 77$ | **100% Preserved** |
| **Portrait composition (headshot, shoulders-up)** | Indices 1 – 7, 22 – 25 | 11 | $1 \le \text{pos} \le 25 \ll 77$ | **100% Preserved** |
| **Face & eyes (centered, warm brown eyes)** | Indices 27 – 28, 30 – 32 | 5 | $27 \le \text{pos} \le 32 \ll 77$ | **100% Preserved** |
| **Skin texture (authentic, subtle pores)** | Indices 34 – 40 | 7 | $34 \le \text{pos} \le 40 \ll 77$ | **100% Preserved** |
| **Hair (rich dark brown wavy)** | Indices 42 – 46 | 5 | $42 \le \text{pos} \le 46 \ll 77$ | **100% Preserved** |
| **Deep crimson satin dance costume** | Indices 48 – 53 | 6 | $48 \le \text{pos} \le 53 \ll 77$ | **100% Preserved** |
| **Gold embroidery across neckline** | Indices 54 – 61 | 8 | $54 \le \text{pos} \le 61 \ll 77$ | **100% Preserved** |
| **Luxury studio lighting** | Indices 63 – 65 | 3 | $63 \le \text{pos} \le 65 \ll 77$ | **100% Preserved** |
| **Negative frame & border exclusions** | Indices 1 – 5 | 5 | $1 \le \text{pos} \le 5 \ll 77$ | **100% Preserved** |
| **Negative hand, finger, & arm exclusions** | Indices 7 – 11, 20 – 21 | 6 | $7 \le \text{pos} \le 21 \ll 77$ | **100% Preserved** |

---

## 7. Comparative Assessment (Phase 2B.4 vs Phase 2B.4A)

| Evaluation Parameter | Phase 2B.4 Initial Candidate | Phase 2B.4A Condensed Candidate |
| :--- | :--- | :--- |
| **Positive Prompt Length** | 137 tokens (including BOS/EOS) | **68 tokens** (including BOS/EOS) |
| **Positive Truncation Status** | **TRUNCATED (60 tokens dropped)** | **ZERO TRUNCATION (9 tokens headroom)** |
| **Costume Descriptors Location** | Tokens 85 – 107 (100% Discarded) | **Tokens 48 – 61 (100% Preserved)** |
| **Negative Prompt Length** | 101 tokens (including BOS/EOS) | **54 tokens** (including BOS/EOS) |
| **Negative Truncation Status** | **TRUNCATED (24 tokens dropped)** | **ZERO TRUNCATION (23 tokens headroom)** |
| **Tokenizer 1 vs Tokenizer 2** | Identical truncation | **Identical preservation** |
| **Risk of Silent Wardrobe Omission** | **100% guaranteed failure** | **0% risk (fully conditioned)** |

---

## 8. Persisted Audit Telemetry

The machine-readable tokenisation audit has been saved to:
- **Audit JSON File:** [`~/.local/share/auravo/models/phase2b_4a/prompt_tokenisation_audit.json`](file:///Users/abhisheksuman/.local/share/auravo/models/phase2b_4a/prompt_tokenisation_audit.json)

---

## 9. Official Verdict

```text
================================================================================
OFFICIAL PHASE 2B.4A VERDICT:
BOTH_PROMPTS_TOKENISATION_VERIFIED
================================================================================
Positive Prompt: 66 content tokens | 68 total with BOS/EOS | 0 truncated (9 headroom)
Negative Prompt: 52 content tokens | 54 total with BOS/EOS | 0 truncated (23 headroom)
BOS (49406) and EOS (49407) preserved across both CLIP text encoders.
Every essential positive subject, ethnic identity, composition, skin, hair,
wardrobe (crimson satin), and embroidery (gold) descriptor is 100% retained.
Every intended negative restriction (frames, hands, fingers, limbs) is 100% retained.
================================================================================
```

---

## 10. Stop Condition & Next Step

Per Section 7 of the Phase 2B.4A instructions:
- **Zero image generation was performed.**
- **No application code was touched.**
- **STOPPING AND AWAITING EXPLICIT HUMAN APPROVAL** before executing any subsequent image generation run.

