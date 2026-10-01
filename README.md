# 💃 Auravo Studio — Autonomous AI Video & Dance Production Engine

> **Multi-Brand Vertical Short-Form Video Studio (9:16)** with AI Choreography, Neural Video Diffusion, Character Face Model Consistency, Voice Narration, Rhythmic Bollywood Audio Mixing, Quality Gate Compliance, and Multi-Platform Publishing Automation.

---

## 🌟 Key Capabilities & Features

### 1. 💃 Dancer Personas & Consistent Face Models
- **7 Pre-Built Luxury Dancer Archetypes**: South Asian (Indian), Latina, East Asian (K-Pop), Western Cabaret, Middle Eastern, African Afro-Fusion, and European Modern Stage.
- **Custom Face Persona Creator**: Generate consistent AI face model portraits with customizable ethnicity, eye shape, bone structure, and signature stage costumes.
- **Face Model Exporter**: 1-click export of high-resolution face portraits (.PNG/.JPG) for use in AI video tools.

### 2. 🎬 Phase 2 Content Engine (5-Beat Vertical Shorts)
- **AI Story Concept Discovery**: Auto-generates viral premises with originality scoring, audience retention hooks, and repetition detection.
- **Custom Story Creator**: Turn any custom prompt or choreography idea into a tailored 5-scene vertical short script.
- **Full Media Asset Synthesis**:
  - **Visuals**: Consistent 9:16 vertical scene artwork generated for every beat.
  - **Audio (TTS)**: Voice direction and narration synthesized with natural cadence and rhythm count-ins.
  - **Subtitles**: Auto-timed SRT caption files with synchronized timestamps.

### 3. 🧠 Neural Video Dance Engine (Colab / Kaggle T4 GPU & Cloud APIs)
- **100% Free GPU Cloud Server (`scripts/colab_dance_diffusion_server.ipynb` & `.py`)**:
  - Runs **Stable Video Diffusion XT** / **MimicMotion** / **LivePortrait** on free Google Colab or Kaggle T4 GPUs (16GB VRAM).
  - **Zero-Signup Instant Tunnel**: Uses Cloudflare Tunnels (`pycloudflared`) to expose a public HTTPS endpoint (`https://*.trycloudflare.com`) with **NO account creation, NO credit card, and NO API tokens required**.
- **1-Click External Video Import**: Paste direct links or upload dance clips generated from **Viggle AI**, **Kling AI**, **LivePortrait**, **Luma Dream Machine**, or **Haiper AI**.
- **Studio Auto-Pilot**: Fast 2.5D camera zoom and pan choreographies generated locally on CPU.

### 4. 🎥 Master 9:16 Video Renderer & Audio Mixing
- **1080x1920 HD FFmpeg Video Pipeline**: Assembles all 5 beats into a single broadcast-quality MP4 master reel.
- **Seamless Video Looping**: Automatically loops shorter 3–5s dance clips to match the full duration of each beat without freezing.
- **Rhythmic Bollywood Beat Mixing**: Automatically layers an energetic Bollywood monsoon dance beat underneath the spoken voiceover.

### 5. 🛡️ Phase 3 Quality Gate & Publishing Calendar
- **Automated Quality Gate (100-Point Safety Score)**:
  - Brand Safety & Policy Compliance verification.
  - Copyright & Monetization Risk inspection.
  - Content Originality & Freshness scoring.
- **Multi-Platform Publishing Calendar**: Schedule posts for **YouTube Shorts**, **Instagram Reels**, and **TikTok**.

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 18, TypeScript, Vite, Vanilla CSS (Glassmorphism & Gold Theme) |
| **Backend** | Node.js (v20+), Express, TypeScript, Zod validation |
| **Database** | SQLite3 (`better-sqlite3`) with database-level ownership isolation |
| **Video Engine** | FFmpeg 8.x (Multi-input concat, minterpolate, pan/zoom, amix) |
| **AI / ML GPU** | PyTorch, Hugging Face `diffusers` (Stable Video Diffusion XT), `pycloudflared`, FastAPI |

---

## 🚀 Getting Started & All Commands

### 📋 Prerequisites
- **Node.js**: v20.0.0 or later
- **FFmpeg**: Installed and available in PATH (`brew install ffmpeg` on macOS, `apt install ffmpeg` on Linux)
- **Python** (optional for local GPU testing): Python 3.10+

---

### 💻 1. Local Development Setup

```bash
# Clone the repository
git clone https://github.com/abhisheksuman854/studio.git
cd studio

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env

# Run API Backend (Port 4000)
npm run dev:server

# In a separate terminal, run Vite Web UI (Port 5173)
npm run dev:web
```
Open **`http://localhost:5173`** in your browser.  
*(First visit: Click "Create owner account" to register your local admin).*

---

### 🧪 2. Typechecking & Automated Tests

```bash
# Run TypeScript compilation check
npm run typecheck

# Run full test suite (Database isolation, Originality, SRT, Content Engine, Quality Gate)
npm test

# Build production bundle
npm run build
```

---

### 🐳 3. Docker Deployment

```bash
# Build and run complete stack in Docker
docker compose up --build
```

---

### ☁️ 4. Free GPU Neural Dance Server (Google Colab / Kaggle)

1. Open **Google Colab** or **Kaggle Notebook**.
2. Set Runtime / Accelerator to **GPU (T4 GPU)**.
3. Run the two cells from [`scripts/colab_dance_diffusion_server.py`](file:///Users/abhisheksuman/Documents/GitHub/studio/scripts/colab_dance_diffusion_server.py):

#### **Cell 1: Install Dependencies**
```bash
!pip install -q fastapi uvicorn pycloudflared nest-asyncio python-multipart torch torchvision torchaudio diffusers transformers accelerate imageio[ffmpeg] opencv-python Pillow requests
```

#### **Cell 2: Start Server**
```python
import os, io, base64, torch, uvicorn, nest_asyncio, threading, time
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pycloudflared import try_cloudflare
from PIL import Image

app = FastAPI(title="Auravo Neural Dance Diffusion Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

class DanceRequest(BaseModel):
    imageBase64: str
    prompt: str = "Bollywood expressive classical dance in monsoon rain"
    durationSec: int = 5

svd_pipeline = None

def get_diffusion_pipeline():
    global svd_pipeline
    if svd_pipeline is None and torch.cuda.is_available():
        print("[Neural Engine] Loading Stable Video Diffusion XT onto GPU...")
        from diffusers import StableVideoDiffusionPipeline
        svd_pipeline = StableVideoDiffusionPipeline.from_pretrained(
            "stabilityai/stable-video-diffusion-img2vid-xt-1-1",
            torch_dtype=torch.float16,
            variant="fp16"
        )
        svd_pipeline.enable_model_cpu_offload()
    return svd_pipeline

@app.post("/api/generate-dance")
async def generate_dance(req: DanceRequest):
    img_bytes = base64.b64decode(req.imageBase64.split(",")[-1])
    input_image = Image.open(io.BytesIO(img_bytes)).convert("RGB").resize((576, 1024), Image.Resampling.LANCZOS)
    output_video_path = "/content/generated_dance.mp4" if os.path.exists("/content") else "generated_dance.mp4"
    pipe = get_diffusion_pipeline()
    if pipe is not None and torch.cuda.is_available():
        from diffusers.utils import export_to_video
        frames = pipe(input_image, decode_chunk_size=8, generator=torch.manual_seed(int(time.time())), motion_bucket_id=180, num_frames=25).frames[0]
        export_to_video(frames, output_video_path, fps=6)
    with open(output_video_path, "rb") as f:
        return {"ok": True, "videoBase64": f"data:video/mp4;base64,{base64.b64encode(f.read()).decode('utf-8')}", "durationSec": req.durationSec}

os.system("fuser -k 8000/tcp 2>/dev/null || true")
nest_asyncio.apply()
tunnel = try_cloudflare(port=8000)
public_url = getattr(tunnel, "tunnel", str(tunnel))
print(f"\n🚀 SVD NEURAL DANCE SERVER URL: 👉 {public_url} 👈\n")

def start():
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")

threading.Thread(target=start, daemon=True).start()
time.sleep(2)
print("✅ Server active and listening for dance requests!")
```

4. Copy the generated `👉 https://xxxx.trycloudflare.com 👈` link.
5. In Auravo Studio, click **`⚙️ Neural AI GPU Settings`**, paste the URL into **Colab / Kaggle Server URL**, and hit **Save Configuration**!

---

## 📁 Repository Structure

```
studio/
├── scripts/
│   ├── colab_dance_diffusion_server.ipynb # Jupyter notebook for Colab / Kaggle T4 GPU
│   └── colab_dance_diffusion_server.py    # Python server with SVD & pycloudflared tunnel
├── server/
│   ├── app.ts                            # Express app, auth, 100MB body parser, static routing
│   ├── content_engine.ts                 # Story generation, scene assembly, video upload & render
│   ├── crud.ts                           # Generic CRUD handlers with ownership validation
│   ├── db.ts                             # SQLite schema initialization and connection
│   ├── index.ts                          # Server entrypoint (Port 4000)
│   ├── migrations/                       # SQL migrations (Phase 1, 2, and 3 tables)
│   ├── providers/                        # Pluggable engines:
│   │   ├── dance_motion.ts               # Local 2.5D camera choreography
│   │   ├── image.ts                      # Scene visual generator
│   │   ├── llm.ts                        # Script & premise synthesis
│   │   ├── neural_dance.ts               # Colab GPU & Cloud API bridge
│   │   ├── originality.ts                # Originality & novelty scoring
│   │   ├── platform_adaptation.ts        # Derivatives for YouTube/IG/TikTok
│   │   ├── quality_gate.ts               # 100-point safety checker
│   │   ├── tts.ts                        # Voice narration generator
│   │   ├── types.ts                      # Provider interface contracts
│   │   └── video.ts                      # FFmpeg master 9:16 short composer & audio mixer
│   └── test/                             # Automated test suite
├── web/
│   ├── index.html                        # Mobile viewport HTML
│   ├── main.tsx                          # Interactive React Studio UI
│   └── vite.config.ts                    # Vite frontend configuration
├── package.json                          # Scripts & dependencies
└── README.md                             # Studio Documentation & Quickstart
```

---

## 📜 License
MIT License. Created with Auravo Studio.
