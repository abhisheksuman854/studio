# 10. Canonical Product Blueprint & Source of Truth

**Product Name**: Auravo Studio  
**Classification**: AI-Powered Virtual Character Creation & Video Generation Studio  
**Status**: Canonical Specification (Supersedes all previous non-aligned business audit drafts)  
**Effective Date**: November 2026  

---

## 1. Product Scope & Canonical Definition

Auravo Studio is an integrated generative video platform that enables non-technical creators to:
1. **Design Original Fictional Characters** using natural language prompts, preserving persistent identity across multiple scenes without requiring user photographs.
2. **Apply Physical Dance, Gestural & Cinematic Motion** to their characters using a Movement Library, Text-to-Motion prompts, or Pose-Extracted Reference Videos.
3. **Produce Broadcast-Quality Master Videos** (1080x1920 9:16 vertical reels) with synchronized voice narration, background score, and dynamic camera choreography.

---

## 2. Definitive Architecture Specification

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   AURAVO STUDIO                                        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  [ FRONTEND LAYER — React 18 + Vite ]                                                  │
│  ├── Character Studio (Text prompt, 4-variation selector, identity sheet, library)     │
│  ├── Motion Studio (Movement library, choreography prompt, reference video extractor) │
│  ├── Video Studio (Cast assignment, staging, audio layering, master preview & export) │
│  └── Advanced Engine Drawer (Worker URL, diffusion checkpoints, VRAM settings)         │
│                                                                                        │
│  [ BACKEND CORE — Node.js 20+ Express + SQLite WAL ]                                   │
│  ├── Character Generator Provider (Token extraction, identity injection, metadata)     │
│  ├── Motion Provider (Procedural camera choreographies + DWPose dispatch)              │
│  ├── Master Video Provider (FFmpeg multi-scene concat, amix audio, subtitle burner)    │
│  ├── Quality Gate Engine (Safety, copyright, and technical asset integrity scoring)    │
│  └── Async Job State Machine (SQLite jobs queue with REST polling endpoints)           │
│                                                                                        │
│  [ AI / GPU WORKER LAYER — Python FastAPI (Colab / Kaggle / Serverless GPU) ]          │
│  ├── Character Diffusion: SDXL-Lightning / FLUX.1 [schnell]                            │
│  ├── Identity Preservation: InstantID / IP-Adapter-FaceID                              │
│  ├── Facial & Lip Expression: LivePortrait                                             │
│  ├── Pose Extraction: DWPose (OpenPose JSON coordinates)                               │
│  └── Body Motion Retargeting: MimicMotion / SVD-XT                                     │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Explicit Product Inclusions vs. Exclusions

### ✅ Strictly INCLUDED in Auravo Studio
- Original text-to-character synthesis with 4-variation candidate preview.
- Persistent character profiles with locked identity tokens stored in SQLite.
- 7 pre-built Luxury Dancer Archetypes (Priya, Elena, Mei, Zara, Maya, Aria, Amara).
- Motion Library featuring classical Indian mudras, Bollywood choreography, and modern gestures.
- Reference-video pose extraction via DWPose (transferring motion while discarding the original person's appearance).
- High-fidelity LivePortrait facial dynamics with driving audio synchronization.
- Master 1080x1920 vertical reel composition with Ken Burns camera motion and Bollywood/corporate score mixing.
- 100-point Quality Gate verifying safety, content originality, and duration compliance.
- Single-owner developer mode with clean path to multi-tenant subscriptions in Phase 4.

### ❌ Strictly EXCLUDED (Out of Scope)
- **Financial Explainer / CA / MFD Pivot**: The previous proposal to turn the tool into a regional tax/mutual fund video generator for accountants is **permanently rejected**.
- **Real-Person Likeness Imitation & Deepfakes**: No celebrity copying, deepfake face-swapping onto non-consenting individuals, or deceptive political impersonations.
- **In-Browser Multi-Track NLE Video Editor**: Auravo is an automated prompt-and-motion factory, not a web clone of Adobe Premiere or DaVinci Resolve.
- **Over-Engineered Infrastructure**: No Kubernetes, microservice meshes, or distributed event buses during MVP phases.

---

## 4. Documentation Reconciliation & Deprecation Notice

The audit files generated during the earlier financial-explainer exploration contain valuable competitor and unit-economics data, but their **strategic recommendations are outdated and superseded by this Phase 1A blueprint**:

| File in `docs/business-audit/` | Status | Recommendation |
|---|---|---|
| `00_EXECUTIVE_SUMMARY.md` | Partially Superseded | Retain for historical financial benchmark reference; Phase 1A blueprint is the binding product direction. |
| `01_existing_product_audit.md` | Active & Valid | Accurate line-by-line capability classification at commit `b34e9ee`. |
| `02_market_and_competitor_analysis.md` | Active & Valid | Competitor analysis (InVideo, AutoShorts, Crayo, OpusClip) remains accurate. |
| `03_business_model_comparison.md` | **Superseded** | Proposed CA/tax niche is superseded by original Character & Video Creator platform. |
| `04_product_gaps_and_feature_priorities.md` | **Superseded** | Replaced by `docs/business-audit/phase-1a-alignment/03_PRODUCT_GAP_ANALYSIS.md`. |
| `05_unit_economics_and_profitability.md` | Partially Valid | Hardware and FFmpeg compute economics remain valid; pricing tiers must reflect creator SaaS. |
| `06_technical_commercial_readiness.md` | Active & Valid | Technical gaps (multi-tenancy, async queues) remain accurate. |
| `07_final_business_recommendation.md` | **Superseded** | Strategic recommendations replaced by `01_ORIGINAL_PRODUCT_VISION.md`. |
| `08_ninety_day_execution_roadmap.md` | **Superseded** | Replaced by `docs/business-audit/phase-1a-alignment/09_PHASED_IMPLEMENTATION_ROADMAP.md`. |

**Binding Source of Truth**: All future development, prompt engineering, and feature implementations for Auravo Studio must reference the specifications located in **`docs/business-audit/phase-1a-alignment/`**.

