# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository is **pre-implementation**: it currently contains only `PRD.md` (the product spec, written in Traditional Chinese). There is no code, build system, dependency manifest, or test suite yet.

**Decided stack (2026-06-12, confirmed with user):**
- **Tech stack**: Node.js full-stack — Node.js backend with WebSocket server; vanilla JS or lightweight framework frontend (no React/Vue required for v1).
- **Access protection**: handled entirely at the Zeabur platform layer (basic auth or IP restriction). v1 has no in-app login/auth code.
- **Deployment**: GitHub-linked auto-deploy on Zeabur — `git push` to the connected branch triggers a deploy automatically.

When scaffolding, choose stack details to match the architecture in `PRD.md` (§9) and the decisions above. There are no build/lint/test commands to document until the project is scaffolded — add them here once they exist.

## What this product is

A **factory-internal bilingual (Mandarin ↔ English) real-time conversation system**, not a general translation tool and not a SaaS. Taiwanese (Chinese-speaking) and foreign (English-speaking) workers share one screen — an iPad, laptop, or PC on the shop floor — and take turns speaking. The screen shows each utterance's source text, instant translation, optional refined translation, and a timestamp.

Target deployment: HTML/PWA frontend + backend API on **Zeabur**, **PostgreSQL** for storage, **OpenAI API** for translation/transcription.

## Architecture (planned, per PRD §9)

Three tiers:

- **Frontend (HTML/PWA)** — mic capture, *local* audio-level metering and threshold detection, bilingual conversation feed, refined-translation ON/OFF toggle, audio-mode controls, glossary admin page. **Never stores the OpenAI API key.** Decides locally when audio crosses the threshold before any AI streaming begins.
- **Backend API (Zeabur)** — holds the OpenAI key, manages sessions, calls Route A / Route B (see below), applies glossary, persists translation logs and settings, returns subtitle updates over HTTPS/WebSocket.
- **PostgreSQL** — glossary terms, translation logs, sessions, audio settings, app/line settings.

### Two-route translation strategy (PRD §6.4) — the central design concept

**Route A — Realtime Transcription + Fast Translation (接法 1 pipeline, always on):**

1. Audio is streamed via WebSocket to OpenAI `gpt-realtime-whisper` (Realtime API transcription session, $0.017/min).
2. `conversation.item.input_audio_transcription.delta` events drive **Draft captions** — the raw in-progress transcript appears character-by-character as line 1.
3. `conversation.item.input_audio_transcription.completed` events emit the finalized source text, which is immediately sent to `gpt-5-mini` for **fast text translation** → displayed as line 2 with badge `[RT]`.

**Route B — Refined Translation (精準翻譯, toggled ON/OFF):**

Runs only *after a sentence completes*, using: full source text + Route A `[RT]` output + active Glossary terms + recent conversation context. Calls `gpt-5-mini` to produce a semantically cleaner translation shown as a third line (`精準翻譯：…`) with badge `[Refined]`.

**Deferred alternative — `gpt-realtime-translate`** (released 2026-05-07, $0.034/min, voice→translated voice+captions): listed as a future A/B test candidate. Deferred for three reasons: (1) source-text caption availability unconfirmed, making the Draft line unreliable; (2) supporting both routes in parallel would require dual concurrent streams, roughly 3× the cost; (3) translation behavior is harder to constrain (glossary injection, output format).

A conversation card moves through states **Draft → RT → Refined** (`[Draft]` while speech is unstable, then a finalized card; the third refined line is appended later only if Route B is ON).

### Audio activation — the core cost-control mechanism (PRD §7.8)

The hard rule: **the microphone device may be Always On, but AI listening must NOT be.** Audio is streamed to the AI only while local volume exceeds a configurable threshold. Two modes:

- **Manual Speak**: user presses a `Speak` button to stream; threshold controls disabled/greyed.
- **Auto Detection / Always On with Threshold**: frontend monitors volume locally; crossing the threshold starts streaming, dropping below it for the silence duration ends it. `Speak` button is shown but disabled. States: **Standby → Listening → Ending**.

**Threshold % ↔ dB linear mapping (decided 2026-06-12):** 0 % = −50 dB, 100 % = 0 dB, linear. Formula: `dB = -50 + threshold% × 0.5`. Example: 60 % ≈ −20 dB. The Level Meter's red threshold line is drawn according to this mapping.

**UI layout for audio settings (decided 2026-06-12):** The main Audio Settings panel on the primary screen shows only three controls: Threshold slider, Level Meter, and Microphone selector. Advanced controls (Silence Duration, Pre-roll Buffer, Cooldown, Max Utterance Duration) are moved into the ⚙ Settings page.

Tunable settings: Activation Threshold, Silence Duration (~700–1000 ms), Pre-roll Buffer (~300–500 ms, prepended on trigger so sentence-initial words like negations/commands aren't clipped), Cooldown, Max Utterance Duration (15–30 s), Input Device, Level Meter.

**Manual mode status bar (decided 2026-06-12):** Remove the duplicate "Ready" / "Status: Online" coexistence. Unified display: `Status: Ready`.

Cost rules: Standby streams nothing; only Listening streams; blank/low-confidence results create no card; Route B runs only on completed valid utterances; background noise must not trigger listening.

## Product constraints that shape the code

- **No speaker classification / diarization.** Conversation cards show *only* timestamp + text — never speaker role, name, "operator", "技術員", etc. Do not add speaker identity.
- **Display ordering is direction-dependent**: when the speaker is Chinese → line 1 Chinese source, line 2 English translation; when English → line 1 English source, line 2 Chinese translation; line 3 is the optional refined translation. Language direction is auto-detected (see subsection below).
- **Conversation feed** is a scrolling wall (not a fixed 3-line window): new cards append at the bottom, auto-scroll pauses when the user scrolls up, and a "new messages — jump to latest" affordance appears.
- **Glossary** lives in PostgreSQL and is applied by Route B for term consistency (e.g. 隔離區 → quarantine area). v1 needs add/edit/disable; approval/versioning/per-line glossaries are later phases.
- A bilingual **safety notice is fixed at the bottom** of the screen.

### Language direction detection (decided 2026-06-12)

Determined from the finalized transcript text using a character-level heuristic:

1. Count CJK characters (Unicode blocks CJK Unified Ideographs U+4E00–U+9FFF and Extension A U+3400–U+4DBF; Katakana/Hiragana are NOT counted — matches PRD §7.9) in the utterance.
2. If the utterance contains CJK characters **and** CJK characters constitute the majority of non-whitespace characters → classify as **Chinese utterance** (line 1 = Chinese, line 2 = English translation).
3. Otherwise → classify as **English utterance** (line 1 = English, line 2 = Chinese translation).
4. Mixed-language utterances are classified by whichever character set is in the majority.

### Session lifecycle (decided 2026-06-12)

- A new transcription session (WebSocket connection to `gpt-realtime-whisper`) is created when the user opens the page.
- The session ends when: (a) the user closes or navigates away from the page, or (b) the session has been idle (no audio streamed) for **30 minutes**.
- On session end the backend tears down the WebSocket and releases resources; the frontend shows a reconnect prompt.

## Cross-session continuity

Claude Code instances are stateless across sessions. To maintain continuity across context resets, usage-limit stops, and handoffs:

- **On session start**: read `docs/PROGRESS.md` before doing any implementation work. It contains the current state, last completed step, and the planned next action.
- **Major decisions**: write them into `docs/DECISIONS.md` (date, decision, rationale, alternatives considered). The decisions already recorded in this CLAUDE.md file should also be reflected there.
- **On session end or when approaching usage limits**: before stopping, append the current state, what was just completed, and the explicit next step to `docs/PROGRESS.md` as a dated handoff entry. Do this *before* stopping — do not defer it.

These two files (`docs/PROGRESS.md`, `docs/DECISIONS.md`) are the authoritative handoff log. Create them if they do not exist.

## Development conventions

- **Multi-agent workflows**: every subagent spawned in a workflow must be assigned an explicit model. Use cheap models (Haiku, Sonnet) for mechanical or high-volume tasks (formatting, extraction, summarization); reserve more capable models for reasoning-heavy or judgment tasks.

## Scope discipline

`PRD.md` §12–13 define MVP scope and phasing. Out of scope for v1: voice output (TTS), multi-tenancy, auth/roles, MES/ERP integration, safety-keyword auto-tagging, speaker diarization, noise reduction/auto-calibration. Don't build these unless asked. When in doubt about a feature's place, consult the phase tables (§13) before implementing.
