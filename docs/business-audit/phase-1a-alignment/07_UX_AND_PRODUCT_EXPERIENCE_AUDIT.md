# 07. UX & Product Experience Usability Audit

**Audit Date**: November 2026  
**System**: Auravo Studio Web Client (`web/main.tsx` — 4,235 lines)  
**Scope**: User Experience Evaluation against the Definitive 3-Studio Product Vision  

---

## 1. Usability Scorecard against Core Principles

| UX Principle | Current State in Code | Assessment | Usability Defect |
|---|---|:---:|---|
| **Approachability for Non-Technical Users** | Technical settings (Cloudflare tunnels, motion buckets, SVD XT seed, VRAM offload) visible in main workflow. | 🟡 Fair | Exposes raw machine-learning parameters rather than intuitive artistic controls. |
| **Clear 3-Studio Layout** | UI has 8 disparate tabs: *Ideas Studio*, *Script & Video Studio*, *Publishing Calendar*, *Characters*, *RAG Knowledge Store*, *Brands*, *Audience Profiles*, *Content Library*. | 🔴 Poor | Conflates story ideation, video editing, motion presets, and character creation across confusing tabs. Motion Studio does not exist as a top-level workspace. |
| **Text-First Character Creation** | Character form asks for name, role, region, appearance, clothing style, personality, and visual prompt. | 🟢 Good | Text fields are clear and structured. |
| **Optional Photo Reference** | Implemented as an optional file/URL input in character creator. | 🟢 Good | Correctly framed as optional. |
| **Visual Variation Previews** | Single generation button generates a single portrait. | 🔴 Poor | No 4-candidate variation grid. The user is forced to accept or start over. |
| **Simple Approval & Saving** | Saved characters appear in a luxury card grid with export actions. | 🟢 Good | Clean glassmorphism cards with portrait view and token tags. |
| **Intuitive Movement Selection** | Movement presets and reference-video uploads are buried inside individual scene beat editors. | 🔴 Poor | No dedicated movement browser or preview gallery. |
| **Progress & Failure Feedback** | `StudioNotificationCard` provides error explanations with Cloudflare HTTP status parsing (521, 524, 530). | 🟢 Good | Human-readable diagnostics when Colab tunnels fail. |
| **Preview Before Export** | In-browser video player previews rendered clips. | 🟢 Good | Responsive video playback controls. |
| **Single Monolithic File** | `web/main.tsx` contains 4,235 lines combining styles, dialogs, state, and 8 screens. | 🔴 Critical | High developer friction; prone to regression during feature additions. |

---

## 2. The Restructured 3-Studio Navigation Architecture

To make Auravo Studio approachable and clean, the UI navigation should be consolidated from 8 fragmented tabs into **Three Focused Creative Studios** with an **Advanced Settings drawer**:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  ✨ AURAVO STUDIO          [ Character Studio ]   [ Motion Studio ]   [ Video Studio ]  │
│                                                                        ⚙️ Settings      │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  [ Character Studio ]                                                                  │
│  ├── 1. Describe Your Character (Text Prompt or Archetype Selector)                   │
│  ├── 2. Candidate Variations (4-Card Grid with 1-Click Selection)                     │
│  ├── 3. Natural Language Refinement ("Make eyes deeper", "Change dress to sapphire")   │
│  └── 4. Approved Character Library (Saved persistent personas ready for video)         │
│                                                                                        │
│  [ Motion Studio ]                                                                     │
│  ├── 1. Movement Library (Classical Mudras, Bollywood, Modern, Walking, Gestures)     │
│  ├── 2. Text-to-Motion Choreography Prompt                                             │
│  └── 3. Dance Reference Video Importer (Pose Extraction & Retargeting)                 │
│                                                                                        │
│  [ Video Studio ]                                                                      │
│  ├── 1. Select Cast (Choose Saved Character)                                          │
│  ├── 2. Select Choreography (Attach Motion Asset from Motion Studio)                   │
│  ├── 3. Staging & Cinematography (Lighting, Camera Angles, Wardrobe, Background)       │
│  ├── 4. Audio & Subtitles (Voiceover Narration + Background Score)                     │
│  └── 5. 1080x1920 Master Reel Preview & 1-Click Export                                 │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Advanced Settings Encapsulation

Non-technical users should never be confronted with technical machine-learning jargon during normal creative tasks.

All technical knobs must be tucked into a dedicated **"⚙️ Advanced Engine Settings"** slide-out modal:
- AI Worker Backend URL (Google Colab / Kaggle / RunPod tunnel URL).
- Worker Secret Key / API Token.
- Diffusion Model Checkpoint (Flux-Schnell vs. SDXL-Lightning vs. Wan2.1).
- Motion Bucket ID & Sampling Steps.
- VRAM Optimization & Sequential Offload Toggles.
- Local FFmpeg CPU Fallback Override.

---

## 4. UI/UX Recommendations for Phase 1

1. **Retain the Elegant Visual Language**: The existing dark glassmorphism aesthetic (`#030712` background, gold/amber rim lighting, and luxury typography) is distinctive and well-received. Keep the CSS styling system.
2. **Modularize `web/main.tsx`**: Decompose the 4,235-line monolith into modular components:
   - `web/components/CharacterStudio.tsx`
   - `web/components/MotionStudio.tsx`
   - `web/components/VideoStudio.tsx`
   - `web/components/SettingsModal.tsx`
   - `web/components/NotificationCard.tsx`
3. **Add 4-Card Variation Grid**: When generating a character, display 4 thumbnail candidates side-by-side with a clear "Select this identity" button on each card.

