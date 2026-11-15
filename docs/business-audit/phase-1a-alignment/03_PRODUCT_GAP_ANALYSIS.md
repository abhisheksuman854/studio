# 03. Product Gap & User Journey Analysis

**Audit Date**: November 2026  
**System**: Auravo Studio  
**Audit Scope**: Intended End-to-End User Journeys vs. Code Reality at Commit `b34e9ee`  

---

## 1. Journey 1: Character Creation & Persistence

```
[ User Text Prompt ]
         │
         ▼
[ Original Character Generation ] ── (Missing Real Diffusion)
         │
         ▼
[ 4-Variation Candidate Grid ] ──── (Missing in UI/API)
         │
         ▼
[ Interactive Preview & Prompt Refinement ] ── (Missing)
         │
         ▼
[ Approval & Reusable Save ] ────── (WORKING in SQLite)
```

| Step | Existing Code Implementation | What Works | What Is Incomplete / Mocked | What Is Missing | Priority |
|---|---|---|---|---|:---:|
| **1. Text Input & Prompting** | `web/main.tsx` (lines 3100–3250)<br>`server/providers/character_gen.ts` | Form captures name, appearance, clothing style, personality, and visual prompt. | Input fields are stored, but prompts are static. | Prompt enhancer / stylistic autocomplete. | **P1** |
| **2. Original Character Generation** | `server/providers/character_gen.ts`<br>`ai_worker/main.py` | Fallback SVG portrait generation via `@resvg/resvg-js`. | Remote GPU route `/api/generate-character` is missing in `ai_worker`. | Integration with text-to-image diffusion model (Flux / SDXL-Lightning) to generate photorealistic synthetic humans. | **P0** |
| **3. Variation Generation** | Nonexistent | None. Single portrait generated per request. | System cannot generate multi-seed candidates in one batch. | 4-variation candidate generator and selection matrix. | **P0** |
| **4. Preview & Refinement** | Nonexistent | User can view the generated portrait. | No iterative prompt modification or seed locking. | Conversational or structured natural language refinement controls. | **P1** |
| **5. Approval & Save** | `server/content_engine.ts`<br>`server/migrations/005` | Character is persisted to `characters` table with identity tokens and parameters. | Fully functional. | None. | **Done** |

---

## 2. Journey 2: Character Animation & Motion Transfer

```
[ Approved Character ]
         │
         ├──► Method 1: Movement Library ────── (WORKING - FFmpeg Procedural Motion)
         │
         ├──► Method 2: Text-to-Motion ──────── (MOCKED - Selects Fixed Motion Filters)
         │
         └──► Method 3: Reference Video Upload ─ (INCOMPLETE - Raw Video Slicing, NO Pose Extraction)
```

| Step | Existing Code Implementation | What Works | What Is Incomplete / Mocked | What Is Missing | Priority |
|---|---|---|---|---|:---:|
| **1. Movement Library Selection** | `server/providers/dance_motion.ts`<br>`server/content_engine.ts` | 5 calibrated 30fps camera motion presets covering intro, mudra flow, stage glide, climax, bow. | Presets are camera-zoom filters rather than skeletal body movement. | Real skeletal animation library (SMPL / OpenPose / 3D BVH). | **P1** |
| **2. Text-to-Motion** | `server/providers/dance_motion.ts` | Dispatches to SVD-XT if GPU worker is online. | Pure camera interpolation when offline. Does not interpret complex choreography text. | Motion-diffusion model (MDM / MotionDiff) or text-guided pose generator. | **P2** |
| **3. Reference-Video Upload** | `server/content_engine.ts:880–940` | Downloads external video, slices into 8s beats with FFmpeg, adds dynamic blur fill. | Slices are used directly as raw video clips. | Pose estimation (DWPose / OpenPose). | **P0** |
| **4. Motion Retargeting** | Nonexistent | None. Physical video is shown. | **Critical Gap**: Does not extract motion from reference video to drive character. | Retargeting pipeline (MimicMotion / Champ / LivePortrait / ComfyUI). | **P0** |
| **5. Animation Preview** | `web/main.tsx` (lines 1450–1650) | Video player displays generated MP4 scene clip. | Fully functional playback. | Multi-clip scrubbing and timeline view. | **P1** |

---

## 3. Journey 3: Video Assembly & Master Production

```
[ Character + Motion ]
         │
         ▼
[ Scene, Outfit & Staging Composition ] ── (WORKING - 5-Beat Story Engine)
         │
         ▼
[ Audio & Voice Synchronization ] ──────── (PARTIAL - macOS 'say' / Music amix)
         │
         ▼
[ Quality Gate & Policy Verification ] ─── (WORKING - 100-Point Safety Check)
         │
         ▼
[ Master 1080x1920 MP4 Video Export ] ──── (WORKING - FFmpeg Composer)
```

| Step | Existing Code Implementation | What Works | What Is Incomplete / Mocked | What Is Missing | Priority |
|---|---|---|---|---|:---:|
| **1. Scene & Beat Setup** | `server/content_engine.ts`<br>`server/migrations/002` | 5-beat vertical story structure (Hook, Build-up, Climax, Sustained Motion, Sign-off). | Scripts are generated via static templates. | Generative LLM scripting (Gemini Flash / OpenAI). | **P1** |
| **2. Audio Track Synthesis** | `server/providers/tts.ts`<br>`server/providers/video.ts` | Background music mixing via FFmpeg `amix`. | Local macOS `say` fails on Linux servers. `audioMode` default bug breaks tests. | Cross-platform neural TTS (Edge-TTS) and fix for `audioMode` default. | **P0** |
| **3. Subtitle Generation** | `server/providers/video.ts` | Generates synchronized `.srt` caption file based on scene timestamps. | Subtitles are not burned into video pixels. | Burned-in, animated word-level captions via FFmpeg subtitles filter. | **P1** |
| **4. Master FFmpeg Composition** | `server/providers/video.ts:36–176` | Concatenates scenes, synchronizes audio, outputs 1080x1920 MP4. | Fully functional and broadcast-ready. | Hardware acceleration flags (`h264_nvenc` / `videotoolbox`). | **P1** |
| **5. Quality Gate Approval** | `server/providers/quality_gate.ts` | Safety, copyright, and originality verification with 100-point score. | Currently fails approval if audio asset is omitted. | Audio regression fix in `content_engine.ts`. | **P0** |

---

## 4. Critical Broken Connections Between Modules

1. **Character Synthesis Disconnect**:
   - `server/providers/character_gen.ts` calls `POST /api/generate-character` on the remote AI worker.
   - `ai_worker/main.py` does not implement this route.
   - **Impact**: Any user requesting a new character silently receives an SVG vector card instead of a diffusion-generated image.
2. **Reference Video "Motion Transfer" Illusion**:
   - The UI offers an "Attach Reference Dance Video" feature.
   - The backend slices the video and replaces the scene clip with the raw slice (`DanceReference/PhysicalVideo`).
   - **Impact**: The generated master video displays the original human in the reference video rather than the user's approved virtual character.
3. **The `audioMode` Test Suite Blocker**:
   - `server/content_engine.ts:1424` defaults `audioMode` to `'music_only'`.
   - Voice synthesis is skipped, so no `AUDIO` asset is stored.
   - `QualityGateEngine.evaluate()` marks `criticalFail = true` due to missing narration audio.
   - The `/approve` route returns HTTP 400, causing test failures in `phase2_content_engine.test.ts` and `phase3_quality_and_schedule.test.ts`.

