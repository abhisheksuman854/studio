# 06. Technical & Commercial Readiness Audit

**Auditor**: Principal Startup SaaS Architect & Systems Security Auditor  
**Audit Scope**: Platform Policy, Copyright & Trust (Phase 9) & Technical Commercial Readiness (Phase 10)  
**System Evaluated**: Auravo Studio Backend & Web Client  

---

## 1. Commercial Readiness Scorecard

To serve paying customers safely, a software product must meet baseline criteria across architecture, data isolation, billing, stability, and legal compliance.

| Category | Readiness Score (0–100%) | Status | Critical Production Blocker |
|---|:---:|:---:|---|
| **Multi-Tenancy & Data Isolation** | **15%** | 🔴 Critical Blocker | Backend restricts registration to 1 user (`SELECT COUNT(*) FROM users > 0 -> 403`). |
| **Billing & Subscription Lifecycle** | **0%** | 🔴 Critical Blocker | Zero payment gateway integration (no Razorpay/Stripe webhooks or subscription tracking). |
| **Job Scheduling & Concurrency** | **20%** | 🔴 Critical Blocker | FFmpeg runs synchronously inside Express request threads. Multiple concurrent renders will crash the Node process. |
| **Platform Policy Compliance** | **70%** | 🟡 Moderate Risk | Quality gate checks exist, but current scripts are templated loops susceptible to YouTube's "Inauthentic Content" flags. |
| **Authentication & Session Security** | **80%** | 🟢 Production Ready | Secure cookie handling, timing-safe password verification (`scryptSync`), CSRF JSON verification. |
| **API Key Security & Privacy** | **85%** | 🟢 Production Ready | No hardcoded API keys in source control; `.env` configuration pattern followed. |
| **Monitoring, Error Handling & Logging** | **25%** | 🔴 Critical Blocker | Basic `console.error()`. No Sentry, structured JSON logging, or automated alert notifications. |
| **Database Durability & Backups** | **40%** | 🟡 Moderate Risk | Local SQLite database file. No automated off-site S3/R2 backup script. |

---

## 2. In-Depth Technical Readiness Gap Analysis

### 2.1 Multi-Tenant Data Isolation
- **Current State**:
  The application currently operates under a single-owner assumption:
  ```typescript
  // server/app.ts:41
  if ((db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c > 0)
    return res.status(403).json({ error: 'registration closed' });
  ```
- **Requirements for Commercial Launch**:
  1. Delete the single-user restriction.
  2. Implement a `tenants` or `organizations` table, or bind all data objects strictly to `ownerId` (e.g., `WHERE ownerId = ?`).
  3. Verify via integration tests that User A cannot read, edit, or render User B's content items, scripts, or assets.

### 2.2 Payment Gateway & Tier Enforcement
- **Current State**:
  The application has no concept of subscriptions, trials, or usage limits.
- **Requirements for Commercial Launch**:
  1. Integrate **Razorpay Subscriptions API** (for Indian UPI Autopay / Credit Cards) or **Stripe Billing** (for international cards).
  2. Implement an SQLite `subscriptions` table:
     ```sql
     CREATE TABLE subscriptions (
       id INTEGER PRIMARY KEY,
       userId INTEGER NOT NULL REFERENCES users(id),
       planTier TEXT NOT NULL, -- 'STARTER', 'PRO', 'AGENCY'
       status TEXT NOT NULL,   -- 'ACTIVE', 'PAST_DUE', 'CANCELLED'
       currentPeriodEnd INTEGER NOT NULL,
       monthlyVideoQuota INTEGER NOT NULL,
       videosUsedThisMonth INTEGER NOT NULL DEFAULT 0
     );
     ```
  3. Implement an Express middleware (`enforceQuota`) on the `/content/:id/render` endpoint that checks if `videosUsedThisMonth < monthlyVideoQuota`.

### 2.3 Job Queue & Asynchronous Worker Architecture
- **Current State**:
  When a user triggers `/content/:id/render`, the Express server spawns FFmpeg child processes synchronously and waits 6–15 seconds before responding. If 3 users render videos simultaneously on a 2-vCPU server, CPU usage spikes to 100%, causing HTTP requests to time out and the web server to become unresponsive.
- **Requirements for Commercial Launch**:
  Decouple video rendering from HTTP request cycles:
  ```mermaid
  sequenceDiagram
    autonumber
    Client->>Express API: POST /content/:id/render
    Express API->>Job Queue (SQLite/Redis): Enqueue Render Job (Job ID)
    Express API-->>Client: 202 Accepted (Job ID, status='QUEUED')
    Worker Process->>Job Queue (SQLite/Redis): Dequeue Job & Execute FFmpeg
    Worker Process->>Storage: Save Master MP4 to data/storage
    Worker Process->>Database: Update Job status='COMPLETED'
    Client->>Express API: GET /jobs/:id/status (Poll every 2s)
    Express API-->>Client: 200 OK (status='COMPLETED', downloadUrl)
  ```

---

## 3. Platform Policy, Copyright & Legal Compliance Audit

### 3.1 YouTube Monetization & The "Inauthentic Content" Policy
- **Risk Assessment**: **HIGH under current codebase; LOW under proposed B2B pivot.**
- **Details**: YouTube's updated partner program policies aggressively demonetize channels that churn out repetitive, templated videos with generic synthetic voiceovers.
- **Compliance Requirement**:
  - Scripts must be uniquely generated based on deep topic prompts rather than static templates.
  - The video output must include genuine instructional or educational value (charts, breakdown steps, numerical data).
  - Include an automated AI disclosure toggle in metadata output so creators comply with YouTube's synthetic media declaration rules.

### 3.2 Copyright & Stock Asset Licensing
- **Current State**: The repository stores local images (`priya_portrait.jpg`, `monsoon_rain_portrait.jpg`) and a background audio track (`bollywood_monsoon_beat.mp3`).
- **Risk Assessment**: If any of these stock assets lack explicit commercial royalty-free licenses, paying customers who publish videos using them could face YouTube ContentID claims or Instagram copyright strikes.
- **Compliance Requirement**:
  - Replace `bollywood_monsoon_beat.mp3` with a verified CC0 / public domain / purchased royalty-free corporate track library (e.g., from Pixabay, Free Music Archive, or purchased AudioJungle commercial licenses).
  - Ensure all visual assets are procedurally generated SVG infographics, user-uploaded assets, or verified commercial stock footage.

### 3.3 Financial & Regulatory Disclaimers (SEBI / FTC / RBI)
- **Competitive Moat**: Financial professionals in India are legally mandated by SEBI/IRDAI to display disclaimer notices on investment-related educational material.
- **Feature Requirement**:
  - Automatically append standard regulatory disclaimers at the bottom of rendered videos (e.g., *"Mutual fund investments are subject to market risks. Read all scheme related documents carefully before investing."*).
  - This turns compliance from a legal headache into a primary selling point for B2B financial advisors.

---

## 4. Minimum Architecture Required for a Commercially Viable MVP (MVM)

To achieve commercial launch within 30 days without over-engineering, the architecture should remain simple, monolithic, and lean:

```
[ Browser / Mobile Client ]
            │ (HTTPS / JSON)
            ▼
[ Node.js Express Server ] ── (Zod Validation + Auth Cookie)
            │
    ┌───────┴───────┐
    ▼               ▼
[ SQLite DB ]   [ SQLite Job Queue ]
(WAL Mode)          │ (Background Worker Loop)
                    ▼
          [ FFmpeg Rendering Engine ]
          ├── Microsoft Edge-TTS (Free Neural Audio)
          ├── Resvg SVG Infographics (Local CPU)
          └── Master MP4 Video Output
                    │
                    ▼
          [ Cloudflare R2 / Local Storage ]
```

### Key Architectural Rules for the MVP:
1. **No Kubernetes or Microservices**: A single $6/mo Linux VPS running Node.js and SQLite can comfortably handle up to 200 active paying subscribers.
2. **No Expensive GPU Servers**: Procedural SVG infographics + Ken Burns camera motion + neural Edge-TTS run 100% on standard x86/ARM CPUs, eliminating costly GPU cloud instances.
3. **Automated SQLite Off-Site Backups**: A lightweight daily cron script (`sqlite3 data/studio.db ".backup '/backup/studio.db'"` uploaded to Cloudflare R2) ensures total disaster recovery.

