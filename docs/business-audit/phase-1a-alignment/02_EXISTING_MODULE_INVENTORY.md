# 02. Existing Module Inventory & Capability Classification

**Audit Date**: November 2026  
**Repository**: `/Users/abhisheksuman/Documents/GitHub/studio`  
**Inspected Commit**: `b34e9ee`  
**Classification Standard**:
- **IMPLEMENTED**: Functional, verified end-to-end implementation exists.
- **PARTIALLY_IMPLEMENTED**: Core logic exists but lacks key components or integration.
- **EXPERIMENTAL**: Prototype, proof-of-concept, or notebook research code.
- **MOCKED**: Simulated, procedural, or hardcoded behavior mimicking an AI model.
- **BROKEN**: Code exists but fails tests or execution.
- **NOT_IMPLEMENTED**: Planned or required capability is absent.
- **UNKNOWN**: Insufficient evidence to classify.

---

## 1. Complete Capability Inventory Matrix

| # | Capability Module | Status | Primary Code Files | Technical Reality & Evidence |
|---|---|:---:|---|---|
| 1 | **Character Generation (Text-to-Character)** | **PARTIALLY_IMPLEMENTED** | `server/providers/character_gen.ts`<br>`server/content_engine.ts` | Calls `${workerUrl}/api/generate-character` if worker is active. However, `ai_worker/main.py` **lacks** that endpoint, so it automatically falls back to local high-resolution SVG portrait rasterization via `@resvg/resvg-js`. |
| 2 | **Character Persistence & Reuse** | **IMPLEMENTED** | `server/migrations/005_phase5_character_entity.sql`<br>`server/providers/character_gen.ts` | Complete SQLite table `characters` with `referenceImage`, `generationParameters`, and `identityTokens`. Supports fetching characters by brand and injecting tokens into future scene prompts. |
| 3 | **Character Identity Token Extraction** | **IMPLEMENTED** | `server/providers/character_gen.ts` (lines 44–58) | `extractIdentityTokens()` extracts key facial, hair, and costume descriptors into an array of up to 8 tokens. Verified by automated unit test `character_entity.test.ts`. |
| 4 | **Character Variations & Refinement** | **NOT_IMPLEMENTED** | `web/main.tsx` (lines 3062–3757) | UI has a single-character creation form. No 4-variation selection grid, candidate preview, or natural-language iterative prompt editing. |
| 5 | **Virtual Dancer Archetypes** | **IMPLEMENTED** | `server/content_engine.ts` (lines 60–140)<br>`scripts/generate_archetype_portraits.ts` | 7 luxury dancer archetypes defined (Priya, Elena, Mei, Zara, Maya, Aria, Amara) with predefined visual prompts, costumes, and signature mudras. Pre-rendered portraits stored in `data/storage/images/`. |
| 6 | **Movement Library & Dance Presets** | **IMPLEMENTED** | `server/providers/dance_motion.ts`<br>`server/providers/rag_engine.ts` | 5 smooth 30fps camera movements anchored on eye-lines (Intro Hook, Mudra Flow, Lateral Stage Glide, Climax Pull-Out, Graceful Bow) implemented via FFmpeg filter chains. |
| 7 | **Text-to-Motion Generation** | **MOCKED** | `server/providers/dance_motion.ts`<br>`server/providers/llm.ts` | Motion descriptions in script scenes select from the 5 fixed FFmpeg camera motion filters or request SVD diffusion. No generative 3D skeletal text-to-motion model. |
| 8 | **Reference-Video Upload & Slicing** | **PARTIALLY_IMPLEMENTED** | `server/content_engine.ts` (lines 880–940) | Downloads YouTube URL or parses uploaded video base64, slices with FFmpeg into 5 beat clips with `boxblur` 9:16 framing, and saves as `REFERENCE_SLICE` assets. |
| 9 | **Pose Estimation & Skeleton Extraction** | **NOT_IMPLEMENTED** | `server/content_engine.ts` | **Zero pose estimation code.** Sliced reference videos are directly substituted into the scene as raw physical video without extracting skeletons (no OpenPose / DWPose). |
| 10 | **Motion Retargeting to Synthetic Character** | **NOT_IMPLEMENTED** | `server/content_engine.ts` | Motion is not retargeted. The raw reference video clip is played directly instead of driving the synthetic character. |
| 11 | **Facial Expression Animation (LivePortrait)** | **EXPERIMENTAL** | `server/providers/face_animator.ts`<br>`ai_worker/main.py`<br>`scripts/test_liveportrait.ts` | Dispatches image + driving audio to remote worker (`/api/jobs/animate-face`). If remote is offline, executes local FFmpeg micro-zoompan anchored on eyes. |
| 12 | **Image-to-Video Diffusion (SVD-XT)** | **EXPERIMENTAL** | `server/providers/neural_dance.ts`<br>`ai_worker/main.py`<br>`scripts/colab_dance_diffusion_server.py` | Dispatches portrait to remote Python FastAPI worker running `StableVideoDiffusionPipeline` (img2vid-xt, 25 frames, 6fps). Requires live GPU tunnel. |
| 13 | **Text-to-Video Direct Generation** | **NOT_IMPLEMENTED** | `server/providers/video.ts` | Video engine requires input scene images or pre-rendered clips. Cannot generate direct video from text prompt without intermediate image synthesis. |
| 14 | **Master 9:16 Video Composition (FFmpeg)** | **IMPLEMENTED** | `server/providers/video.ts` (lines 36–176) | Concatenates multi-scene video clips, loops short clips, mixes speech and background audio tracks (`amix`), preserves 1080x1920 aspect ratio, outputs broadcast-ready MP4. |
| 15 | **Subtitle SRT Generation** | **IMPLEMENTED** | `server/providers/video.ts` (lines 9–34) | Calculates millisecond SRT caption blocks based on scene durations. |
| 16 | **Animated Burned-in Subtitles** | **NOT_IMPLEMENTED** | `server/providers/video.ts` | Subtitles are saved to `.srt` file; they are **not burned into the MP4 video stream** via FFmpeg `subtitles` or `drawtext` filters. |
| 17 | **Voiceover Narration (TTS)** | **PARTIALLY_IMPLEMENTED** | `server/providers/tts.ts` | Uses macOS CLI `say -v Samantha` or `Lekha` (Hindi) and encodes to MP3. Falls back to FFmpeg noise synthesizer on Linux/Docker. |
| 18 | **Asynchronous Job State Machine** | **IMPLEMENTED** | `server/jobs.ts`<br>`server/migrations/004_phase4_async_jobs.sql` | Full lifecycle management (`QUEUED`, `INITIALIZING`, `GENERATING_MOTION`, `COMPLETED`, `FAILED`) in SQLite with REST polling endpoints. |
| 19 | **Quality Gate & Safety Compliance** | **IMPLEMENTED** | `server/providers/quality_gate.ts` | 100-point safety and compliance evaluation checking prohibited topics, sensitive keywords, and technical asset integrity. |
| 20 | **Publishing & Scheduling Workflows** | **MOCKED** | `server/content_engine.ts` (lines 1764–1841) | `/content/:id/schedule` writes to SQLite table `publishing_schedules`. Zero real integration with YouTube Data API, Meta Graph API, or TikTok API. |
| 21 | **User Authentication & Multi-Tenancy** | **BROKEN** | `server/app.ts` (lines 25–54) | Cookie-based session auth with scrypt password hashing is implemented, but line 41 explicitly blocks registration if user count > 0 (`403 Forbidden`). |
| 22 | **Analytics & Performance Tracking** | **NOT_IMPLEMENTED** | Codebase-wide | Zero lines of analytics code. |
| 23 | **Cost Tracking & Usage Metering** | **NOT_IMPLEMENTED** | Codebase-wide | Zero lines of compute or API cost tracking code. |

---

## 2. Detailed Technical Breakdown of Key Modules

### 2.1 Character Generator Module
- **File**: `server/providers/character_gen.ts` (318 lines)
- **Primary Function**: `CharacterGeneratorProvider.generateAndPersistCharacter()`
- **Execution Path**:
  1. Computes `identityTokens` from `options.appearance` and `options.clothingStyle`.
  2. Inspects `options.aiWorkerUrl || process.env.NEURAL_DANCE_GPU_URL`.
  3. If present, attempts `POST ${workerUrl}/api/generate-character`.
  4. In `ai_worker/main.py`, lines 232–378, available routes are:
     - `GET /health`
     - `POST /api/jobs/animate-face`
     - `POST /api/jobs/dance`
     - `GET /api/jobs/{id}`
     - `POST /api/generate-dance`
  5. The request fails with HTTP 404, caught by `catch (err)`.
  6. Falls back to generating an SVG card with `@resvg/resvg-js`, saves to `data/storage/images/char_<name>_<timestamp>.png`.
  7. Inserts character into SQLite table `characters`.
- **Verdict**: The database, token extraction, and fallback work cleanly, but true diffusion-based character generation is currently disconnected.

### 2.2 Face Animator Module (LivePortrait)
- **File**: `server/providers/face_animator.ts` (188 lines)
- **Primary Function**: `LivePortraitFaceAnimatorProvider.animateFace()`
- **Execution Path**:
  1. Checks for `workerUrl`.
  2. If online, sends `multipart/form-data` containing `image`, `motionPreset`, `durationSec`, and optional `drivingAudio` to `POST /api/jobs/animate-face`.
  3. Polls `GET /api/jobs/{id}` until completed, then downloads `video.mp4`.
  4. If worker is absent, executes `renderLocalFacialMotion()`: spawns FFmpeg `zoompan` with micro-zoom anchored at eye-line (`ih*0.25`).
- **Verdict**: Excellent dual-mode architecture. Verified by test `server/test/face_animation.test.ts`.

### 2.3 Motion & Camera Choreography Module
- **File**: `server/providers/dance_motion.ts` (104 lines)
- **Primary Function**: `AIDanceMotionProvider.generateDanceClip()`
- **Execution Path**:
  1. If `USE_HF_MOTION === 'true'`, attempts `@gradio/client` connection to `KwaiVGI/LivePortrait`.
  2. Otherwise, executes 1 of 5 calibrated FFmpeg procedural motion filters matching the scene beat order.
- **Verdict**: Fully functional local procedural engine. Produces 30fps smooth camera movement over static portraits without GPU cost.

### 2.4 Reference Video Slicing Module
- **File**: `server/content_engine.ts` (lines 880–940)
- **Primary Function**: `POST /api/content/:id/attach-reference-dance`
- **Execution Path**:
  1. Downloads external video URL or writes base64 payload to disk.
  2. Loops through script scenes (beats 1 through 5).
  3. Executes FFmpeg with `-ss <offset> -t <dur>` and a `boxblur` 9:16 background padding filter.
  4. Saves output as `REFERENCE_SLICE` asset, then updates `SCENE_VIDEO` asset to point directly to this slice.
- **Verdict**: Works well as a video cutter, but does not perform pose extraction.

### 2.5 Video Rendering Pipeline
- **File**: `server/providers/video.ts` (176 lines)
- **Primary Function**: `FFmpegVideoProvider.renderShort()`
- **Execution Path**:
  1. Iterates over scenes, ensuring all video clips match required duration.
  2. Writes temporary clip list to a concat file (`concat.txt`).
  3. Runs FFmpeg concat demuxer.
  4. Injects voiceover narration and background music track with `amix=inputs=2:duration=first`.
  5. Outputs broadcast-ready 1080x1920 H.264 / AAC MP4 file.
- **Verdict**: Fully functional, high-performance, and production-ready.

