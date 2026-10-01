# Content Studio — Phase 1 (Foundation)
Multi-brand AI content studio. Phase 1: auth, brands, audience profiles, content library, SQLite, FFmpeg check. ₹0 to run.

## Run (needs Node 20+, FFmpeg installed)
    cp .env.example .env
    npm install
    npm run dev:server    # API on :4000
    npm run dev:web       # UI on http://localhost:5173
Production-style: `npm run build && npm start` → http://localhost:4000. Or `docker compose up`.
First visit: "Create owner account" (registration closes after the first user). `npm test`, `npm run typecheck`.
