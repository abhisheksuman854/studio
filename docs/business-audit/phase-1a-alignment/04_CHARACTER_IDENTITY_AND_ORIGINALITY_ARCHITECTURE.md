# 04. Character Identity, Consistency & Originality Architecture

**Audit Date**: November 2026  
**System**: Auravo Studio — Character Studio Architecture  
**Scope**: Fictional Character Generation, Identity Preservation, and Likeness Safeguards  

---

## 1. The Core Conceptual Distinctions

A common architectural trap in AI media platforms is conflating distinct identity layers. In Auravo Studio, we strictly distinguish four levels of character representation:

```
Level 1: Generating a Face (Text-to-Image with single prompt)
    │
    ▼
Level 2: Generating a Consistent Character (Multi-angle visual reference sheet)
    │
    ▼
Level 3: Character Identity Conditioning (Embeddings, IP-Adapter, Identity Tokens)
    │
    ▼
Level 4: Cross-Video Temporal Identity Preservation (Image-to-Video with Face Lock)
```

1. **Level 1 (Generating a Face)**: Any standard diffusion model (Flux, SDXL) can generate a face from text. However, running the prompt twice generates two completely different people.
2. **Level 2 (Character Consistency)**: The character maintains identifiable facial bone structure, eye shape, nose bridge, skin undertones, and hair across varied expressions, outfits, and lighting.
3. **Level 3 (Identity Conditioning)**: Using technical representations (IP-Adapter face embeddings, InstantID keypoints, or identity tokens) to condition new generations on the approved identity without fine-tuning a full model checkpoint.
4. **Level 4 (Video Identity Preservation)**: Feeding the conditioned character reference into video diffusion engines (LivePortrait for facial dynamics, MimicMotion / SVD for full-body action) without facial drift or warping.

---

## 2. Character Generation Architecture: Text-First Originality

### 2.1 Why Text-First Fictional Generation is Mandatory
Auravo Studio is designed to create **original fictional virtual personalities**, not a tool for deepfaking or copying real humans.

- **Default User Flow**: The user enters a descriptive prompt (e.g., *"22-year-old classical soloist, high arched eyebrows, deep amber eyes, sharp jawline, high cheekbones, regal expression, wearing ornate emerald and gold silk"*).
- **Seed & Parameter Locking**: The system generates 4 candidate seeds. Once the user selects their preferred candidate:
  1. The base image is saved to `data/storage/images/char_<name>_<timestamp>.png`.
  2. The system generates an **Identity Token Profile** (up to 8 locked visual descriptor tokens).
  3. The generation seed, model version, and aspect ratio are recorded in `characters.generationParameters`.

### 2.2 Technique Evaluation: LoRA vs. Reference Conditioning

| Technique | How It Works | Latency / Compute | Consistency Score | Production Feasibility for Auravo MVP |
|---|---|:---:|:---:|:---:|
| **Full Model Fine-Tuning** | Fine-tunes all weights of SDXL / Flux on 20+ images of the character. | 20–40 mins on A100 GPU; ~$2–$5 per character. | 95% | **Unviable for MVP**. Too slow and expensive for non-technical users. |
| **Character LoRA Training** | Trains a small adapter (16MB–100MB) on 10–15 character portraits. | 5–10 mins on T4/A10G GPU; ~$0.50 per character. | 90% | **Postpone to Phase 2**. Excellent for premium users, but adds friction for onboarding. |
| **IP-Adapter-FaceID / InstantID** | Extracts facial embedding vector from approved portrait; conditions diffusion cross-attention layers. | **Instant (<3 seconds)**; runs in standard inference pass. | **85%–88%** | **RECOMMENDED FOR MVP**. Zero training wait time, zero extra storage, instant reuse. |
| **Identity Token Injection (Current Repo)** | Extracts textual tokens (e.g., "amber eyes", "sharp cheekbones") and injects into scene prompts. | **0 ms (Text only)**. | 45%–55% (Faces drift between scenes). | **Current Baseline**. Functional as a lightweight prompt enhancer, but insufficient on its own for photoreal consistency. |

### 2.3 Recommended MVP Character Pipeline: "Reference Conditioning + Multi-Angle Sheet"
For Auravo Studio Phase 1, we recommend a **hybrid reference conditioning pipeline**:
1. **Initial Text-to-Image Generation**: Use SDXL-Lightning or Flux-Schnell to generate a high-resolution frontal portrait from the user's text description.
2. **Automated Multi-Angle Reference Sheet**: Once the user approves the frontal portrait, the system automatically generates:
   - 3/4 angle portrait.
   - Profile view (side).
   - Full-body standing pose with signature stage costume.
3. **Reference Ingestion for Video**: The frontal portrait is fed directly into **LivePortrait** (for facial dialogue/singing) and **MimicMotion / SVD** (for dance movement).

---

## 3. Originality, Likeness & Misuse Safeguards

### 3.1 Celebrity & Public Figure Filter
- **Guardrail**: Before sending prompts to image generation models, the text passes through an in-memory prohibited entity list containing known public figures, celebrities, political leaders, and trademarked characters.
- **Action**: Prompts containing names of real living persons are rejected with a clear message:  
  *"Auravo Studio is designed to create original fictional characters. Prompts referencing real individuals are not permitted."*

### 3.2 Reference-Image Consent & Provenance Policy
When a user chooses the optional reference-image upload path:
1. **No Assumption of Ownership**: An uploaded image is never treated as proof of copyright ownership or consent.
2. **Explicit Attestation**: The user must check a non-negotiable confirmation:  
   *"I confirm that I own this image or have explicit consent from the subject. I will not use this tool to replicate non-consensual likenesses."*
3. **Provenance Watermarking & Audit Trails**:
   - Every generated asset receives cryptographic metadata recording `ownerId`, generation timestamp, base model, and source prompt hash.
   - Enables abuse reporting and rapid takedowns if a user attempts malicious impersonation.

