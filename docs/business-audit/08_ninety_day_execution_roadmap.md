# 08. Ninety-Day Execution Roadmap & Operating Plan

**Auditor**: Principal Startup Operations Strategist & Engineering Lead  
**Execution Target**: Launching & Scaling "Vani Studio" to Profitable Recurring Revenue  
**Timeline**: 90 Calendar Days  
**Founder Capacity Assumed**: Part-time / Nights & Weekends (12–15 hours / week)  

---

## 1. Roadmap Architecture Overview

```mermaid
flowchart LR
  subgraph Phase 1: Days 1-15
    P1A[Strategic Purge] --> P1B[Customer Discovery]
    P1B --> P1C[Offer Validation]
  end

  subgraph Phase 2: Days 16-30
    P2A[Core Refactor] --> P2B[Razorpay Billing]
    P2B --> P2C[MVM Hardening]
  end

  subgraph Phase 3: Days 31-60
    P3A[Soft Launch] --> P3B[First 10 Customers]
    P3B --> P3C[Break-Even Milestone]
  end

  subgraph Phase 4: Days 61-90
    P4A[Retention & Churn] --> P4B[Scale to 50 Subs]
    P4B --> P4C[GO/SCALE Decision Gate]
  end

  Phase 1 --> Phase 2 --> Phase 3 --> Phase 4
```

---

## 2. Day-by-Day Implementation Plan

### Phase 1: Days 1–15 — Validation & Codebase Purge
**Primary Objective**: Strip unviable dancer modules, validate willingness to pay with 10 prospective B2B users, and finalize pricing.

- **Day 1–3: Codebase Cleanup**:
  - Delete `DANCER_ARCHETYPES` and glamour prompt templates from `server/content_engine.ts`.
  - Remove `scripts/colab_dance_diffusion_server.py` and references to `pycloudflared`.
  - Remove single-owner registration lock in `server/app.ts` (`SELECT COUNT(*) FROM users`).
- **Day 4–7: Customer Problem Validation (Faceless Direct Outreach)**:
  - Identify 30 Indian Mutual Fund Distributors (MFDs), Chartered Accountants (CAs), and independent financial advisors on LinkedIn who do not post video content.
  - Manually create 3 sample financial explainer shorts in Hindi (e.g., "Mutual Fund vs Fixed Deposit in 2026", "Save ₹50,000 under 80C", "Health Insurance Portability Rules") using the existing FFmpeg engine with financial text overlays.
  - Send direct messages sharing the video: *"I built an automation tool that generates these ready-to-post Hindi educational reels for financial practices in 20 seconds. Would you pay ₹999/mo to have 30 of these generated automatically every month?"*
- **Day 8–11: Landing Page & Pre-Registration**:
  - Deploy a clean, minimal landing page (using Tailwind/Vite) explaining: *"Turn Any Financial Topic into a Ready-to-Post Hindi/Bengali Reel in 20 Seconds"*.
  - Embed 3 sample videos directly on the landing page.
  - Include an early-access waitlist form (offering 50% discount for first 20 beta users).
- **Day 12–15: Exit Gate Assessment**:
  - **Milestone Exit Criteria**: At least 5 prospective customers explicitly confirm: *"Yes, if the tool can produce videos of this quality with my firm's name and compliance disclaimers, I will subscribe at ₹999/month."*

---

### Phase 2: Days 16–30 — MVP Refactoring & Billing Integration
**Primary Objective**: Deliver a production-ready, multi-tenant Minimum Viable Product (MVP) with automated billing.

- **Day 16–19: Generative AI & Regional Audio Integration**:
  - Integrate **Google Gemini 1.5 Flash API** in `server/providers/llm.ts` with structured JSON output for 5-beat financial explainer scripts (Hook, Concept, Data Comparison, Warning/Tip, CTA).
  - Integrate **Microsoft Edge-TTS** (`node-edge-tts` or lightweight python worker) in `server/providers/tts.ts` supporting `hi-IN-MadhurNeural`, `hi-IN-SwaraNeural`, and `bn-IN-BashkarNeural`.
- **Day 20–23: Procedural Financial Infographic Engine**:
  - Build 4 clean, SVG-based visual layouts using `@resvg/resvg-js`:
    1. *Comparison Grid* (e.g., Option A vs Option B).
    2. *Key Metric Callout* (e.g., Large percentage number + growth icon).
    3. *Step-by-Step Checklist* (e.g., 3 tax-saving rules).
    4. *Regulatory Disclaimer & Branding Card* (User logo + SEBI compliance text).
- **Day 24–27: Payment Gateway & User Quotas**:
  - Integrate **Razorpay Subscriptions** API with UPI Autopay / Credit Cards.
  - Implement SQLite subscription tracking and quota validation (Starter: 15 vids/mo @ ₹499; Pro: 45 vids/mo @ ₹999).
- **Day 28–30: End-to-End Testing & Deployment**:
  - Deploy application to a **$6/month Hetzner Cloud VPS** (Ubuntu 24.04, Docker, Node.js 22, FFmpeg).
  - Set up Cloudflare SSL, automatic SQLite daily backup script to Cloudflare R2, and health monitoring.
  - **Milestone Exit Criteria**: Founder can sign up as a new user, pay ₹1 on Razorpay test mode, enter a topic, and receive a completed Hindi financial MP4 video within 25 seconds.

---

### Phase 3: Days 31–60 — Public Launch & The First 10 Paying Customers
**Primary Objective**: Onboard beta users, secure the first 10 paying customers, achieve cash flow break-even, and gather usage feedback.

- **Day 31–35: Private Beta Onboarding**:
  - Send private beta invites to the waitlist from Phase 1.
  - Offer a special Launch Deal: ₹499/month for life (normally ₹999/mo) for the first 20 subscribers.
- **Day 36–45: Faceless Content Marketing & Community Seeding**:
  - Launch the official "Vani Studio" faceless YouTube Shorts and Instagram channels.
  - Post 1 daily demonstration video showing a real tax or investment question being turned into a Reel in 20 seconds.
  - Share free financial video scripts and templates in Indian CA/MFD Telegram and WhatsApp groups.
- **Day 46–52: Direct Outbound Cadence**:
  - Reach out to 15 new prospective financial advisors every day on LinkedIn with pre-generated personalized sample videos.
- **Day 53–60: First Commercial Review**:
  - Audit customer retention: Are subscribers generating their full monthly quota?
  - Identify drop-off points in the generation workflow and fix friction points.
  - **Milestone Exit Criteria**:
    - **Minimum 10 Paying Customers** active on paid subscriptions.
    - **Gross MRR**: ₹7,500 – ₹10,000 / month.
    - **Cash Break-Even Reached**: Monthly subscription revenue exceeds all hosting and API expenses.

---

### Phase 4: Days 61–90 — Commercial Validation & Scaling
**Primary Objective**: Expand customer acquisition channels, lower churn, improve video aesthetic quality, and decide on scaling.

- **Day 61–70: Burned-in High-Impact Subtitles Upgrade**:
  - Implement word-by-word highlighted captions (yellow/cyan) directly into the video stream via FFmpeg `libass` filter to improve mobile engagement metrics for users.
- **Day 71–80: SEO & Lead Magnet Rollout**:
  - Publish 10 programmatic landing pages targeting search intent:
    - *"AI Video Generator for Financial Advisors"*
    - *"Automated Hindi Reels for Mutual Fund Distributors"*
    - *"Chartered Accountant Social Media Video Software"*
  - Release a free "Financial Script Generator" tool on the homepage to capture email leads.
- **Day 81–87: Referral & Word-of-Mouth Engine**:
  - Implement a 20% recurring affiliate/referral program: existing subscribers who refer another financial advisor receive 20% off their monthly bill.
- **Day 88–90: Comprehensive 90-Day Financial Review & Strategic Gate**:
  - Compile final revenue, churn, and operating metrics.
  - **Milestone Exit Criteria & Decision Gate**:
    - **Target MRR**: **₹40,000 to ₹60,000 / month** (~40–60 active paying subscribers).
    - **Gross Margin**: >90%.
    - **Monthly Churn**: Under 8%.
    - **Strategic Decision**: If MRR > ₹35,000 with low churn, proceed to scale customer acquisition. If MRR < ₹15,000 despite outreach, evaluate customer objections and iterate on feature set.

---

## 3. Summary Timeline & Milestones Table

| Timeframe | Key Operational Milestone | Target Revenue (MRR) | Infrastructure Cost | Founder Weekly Hours |
|---|---|:---:|:---:|:---:|
| **Days 1–15** | Code Purge & 10 User Discovery Interviews | ₹0 | ₹0 (Local) | 12 hrs/wk |
| **Days 16–30** | Refactor Core, Edge-TTS, Razorpay & Deploy | ₹0 | ₹500 ($6 VPS) | 15 hrs/wk |
| **Days 31–45** | Beta Launch & First 5 Paying Customers | ₹3,500 – ₹5,000 | ₹600 | 12 hrs/wk |
| **Days 46–60** | **Break-Even Passed** (15 Paying Customers) | ₹12,000 – ₹15,000 | ₹800 | 10 hrs/wk |
| **Days 61–75** | Word-of-Mouth & SEO Expansion (30 Customers) | ₹25,000 – ₹30,000 | ₹1,200 | 10 hrs/wk |
| **Days 76–90** | **Target Scale** (45–55 Paying Subscribers) | **₹40,000 – ₹55,000** | **₹1,800 (~$21 USD)** | **8 hrs/wk** |

