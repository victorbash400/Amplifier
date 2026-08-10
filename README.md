[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python_3.12-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Google ADK](https://img.shields.io/badge/Google_ADK-Gemini_3.1_Pro-4285F4?logo=google&logoColor=white)](https://google.github.io/adk-docs/)
[![Vertex AI](https://img.shields.io/badge/Vertex_AI-Agent_Engine-4285F4?logo=googlecloud&logoColor=white)](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/overview)
[![ClickHouse](https://img.shields.io/badge/ClickHouse-MCP_%2B_Media_Index-FFCC01?logo=clickhouse&logoColor=000000)](https://clickhouse.com/)
[![Cloud Run](https://img.shields.io/badge/Runtime-Google_Cloud_Run-4285F4?logo=googlecloud&logoColor=white)](https://cloud.google.com/run)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL_16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

# Amplifier

### Accessibility-first agentic media editor

Amplifier is a project-based media editor for producing synchronized accessibility alternatives alongside the original video, audio, and images. A user can edit the timeline directly or ask Agent to place media, find exact source moments, create captions and descriptions, generate Braille or ASL tracks, reduce sensory load, clean dialogue, and translate timed speech.

Built for the [Agentic Cinema: The Blockbuster Hackathon](https://agentic-cinema.devpost.com/).

[Live application](https://amplifier-frontend-102052243896.africa-south1.run.app) ·
[Architecture](#architecture) ·
[Local setup](#local-setup) ·
[Deployment](#deployment)

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>Vision</h3>
      <p>Creates timed audio descriptions and spoken on-screen text, raises contrast, applies colour-safe rendering, and presents larger text.</p>
    </td>
    <td width="33%" valign="top">
      <h3>Hearing</h3>
      <p>Creates captions and transcripts, produces synchronized ASL cues, and generates noise-reduced audio or video assets.</p>
    </td>
    <td width="33%" valign="top">
      <h3>Deafblind</h3>
      <p>Produces Unified English Braille and BRF, structured descriptions, labels, navigation landmarks, and tactile-cue metadata.</p>
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <h3>Sensory</h3>
      <p>Creates lower-flash, lower-motion, stabilized, lower-stimulation, fewer-cut, and nearly static versions of selected video.</p>
    </td>
    <td width="33%" valign="top">
      <h3>Language</h3>
      <p>Translates captions, dialogue, and audio descriptions while preserving speaker turns, source timing, and distinct voice presentation.</p>
    </td>
    <td width="33%" valign="top">
      <h3>Agentic timeline</h3>
      <p>Lets Agent inspect project files and a verified Timeline Shot, perform structural edits, and hand one bounded task at a time to a specialist.</p>
    </td>
  </tr>
</table>

> ### Current architecture
>
> - **Product surface:** Next.js 16, React 19, TypeScript, and Auth.js on Cloud Run
> - **Media API:** FastAPI on Cloud Run with FFmpeg, FFprobe, and Liblouis
> - **Agent runtime:** Google ADK on Vertex AI Agent Engine with Gemini 3.1 Pro Preview
> - **Media understanding:** Gemini 3 Flash Preview, Gemini Embedding 2, and Google Cloud Speech-to-Text V2
> - **Accessible output:** Google Cloud Text-to-Speech, Translation LLM, Chirp 3 HD voices, CWASA SiGML playback, and FFmpeg transforms
> - **Application state:** PostgreSQL 16 on Cloud SQL; SQLite uses the same query contract locally
> - **Media storage:** private Google Cloud Storage objects scoped by project and asset
> - **Media memory:** ClickHouse moment, transcript, silence, speaker, and language-plan records with a scoped MCP surface
>
> **System invariant:** an agent never invents an asset, clip, timestamp, storage key, or revision. Every mutation is authorized against the active account and project, validated against the canonical timeline, and committed with the expected revision and an idempotency key.

## Product workflow

```text
Create or open a project
          │
          ▼
Upload video, audio, and images directly to GCS
          │
          ├── FFprobe verifies duration and audio presence
          └── project registry records ownership and object generation
          │
          ▼
Index useful media once
          │
          ├── Gemini creates timestamped visual and audio moments
          ├── Speech-to-Text creates timed transcript cues
          ├── FFmpeg finds silence and renders preview frames
          └── ClickHouse stores text, vectors, timing, and status
          │
          ▼
Edit manually or ask Agent
          │
          ├── capture a verified Timeline Shot
          ├── place, move, trim, split, replace, or mix media
          ├── delegate one accessibility task to a specialist
          └── stream reasoning, tools, timeline changes, and completion
          │
          ▼
Review synchronized alternatives in the viewer
          │
          ├── captions / transcript / Braille
          ├── ASL avatar track
          ├── descriptions / translated speech / clean audio
          └── accessible visual or sensory variant
```

## Architecture

```mermaid
flowchart LR
    U["User"] --> WEB["Next.js frontend<br/>Cloud Run"]
    WEB --> AUTH["Auth.js + account context"]
    WEB --> API["FastAPI media service<br/>Cloud Run"]

    API --> PG["Cloud SQL<br/>accounts, projects, assets,<br/>timelines, skills, idempotency"]
    API --> GCS["Google Cloud Storage<br/>source and derived media"]
    API --> CH["ClickHouse<br/>moments, transcripts,<br/>silence, speakers, caches"]
    API --> FFMPEG["FFmpeg / FFprobe / Liblouis"]
    API --> GOOGLE["Speech, Translation,<br/>Text-to-Speech, Gemini"]

    WEB --> SSE["SSE chat stream"]
    SSE --> API
    API --> AE["Vertex AI Agent Engine"]
    AE --> ADK["Google ADK"]
    ADK --> EDIT["Agent"]
    EDIT --> V["Vision"]
    EDIT --> H["Hearing"]
    EDIT --> D["Deafblind"]
    EDIT --> S["Sensory"]
    EDIT --> L["Language"]

    ADK --> MCP["Project-scoped ClickHouse MCP"]
    ADK --> TOOLS["Authenticated typed tool gateway"]
    MCP --> CH
    TOOLS --> API
```

The frontend and backend run as separate Cloud Run services in `africa-south1`. Vertex AI Agent Engine runs the warm ADK application in `europe-west1`; Gemini model calls use the configured global endpoint. Agent Engine receives compact project and timeline context rather than media bytes. Source and generated media remain in GCS beside the media service.

## Agent system

Amplifier deploys one ADK application containing Agent and five task specialists. Agent owns project browsing and structural timeline edits. It delegates only when a request requires one specialist accessibility domain, and it retains responsibility for preparing the timeline selection before that handoff.

| Role | Responsibility | Representative tools |
|---|---|---|
| Agent | Project inspection, moment retrieval, asset placement, and timeline structure | `list_project_assets`, `search_media`, `insert_asset_at_playhead`, `move_clip`, `trim_clip`, `split_clip`, `replace_clip`, `set_volume` |
| Vision | Visual access and visual presentation | `inspect_visual_issue`, `apply_audio_description`, `apply_spoken_text`, `apply_contrast`, `apply_colour_safe`, `apply_large_text` |
| Hearing | Audio access and dialogue clarity | `read_transcript`, `apply_captions`, `apply_asl`, `apply_noise_reduction` |
| Deafblind | Access that depends on neither sight nor hearing | `apply_braille_text`, `apply_structured_description`, `apply_labels`, `apply_navigation`, `apply_tactile_cues` |
| Sensory | Photosensitivity, motion, cuts, shake, and stimulation | `inspect_sensory_issue`, `reduce_flash`, `reduce_motion`, `stabilize`, `reduce_cuts`, `reduce_stimulus`, `create_static_version` |
| Language | Timed localization of text and speech | `read_speaker_turns`, `translate_captions`, `translate_audio`, `translate_descriptions` |

Every role can read the verified Timeline Shot, current selection, attached skills, and its own allowlisted tools. Specialists run as ADK task agents with a structured `completed` or `blocked` result. A blocked specialist returns the exact structural action Agent must perform before one bounded retry.

### Timeline Shot

A Timeline Shot is the compact, server-verifiable representation of what the agent needs to edit:

- project ID and canonical revision;
- playhead and selected clip IDs;
- clip IDs, owned asset IDs, names, types, roles, lanes, start times, source trims, and durations;
- linked audio/video relationships;
- visual and audio track counts;
- caption and ASL track state when attached.

The frontend presents the shot as an attachment moving from the timeline into the agent stream. The payload gives the model the same structure the user sees without sending a full-resolution timeline screenshot or the media library on every turn.

### Working behavior

Before the first mutation, the active agent states the exact change it is about to make. Timeline mutations run sequentially. Tool calls and results stream into the conversation, the active specialist appears in the header, the timeline switches to its matching mode, and the timeline receives a working-state treatment only while a timeline tool is active.

Successful mutation results carry the new canonical timeline and changed time/lane range. Expected failures return structured codes, retryability, and a concrete action; they do not crash the ADK stream or become false success messages.

## Canonical timeline

Cloud SQL stores one authoritative timeline document per account-owned project.

```json
{
  "revision": 8,
  "clips": [
    {
      "id": "clip-id",
      "assetId": "owned-asset-id",
      "start": 12.5,
      "duration": 4.0,
      "lane": 0,
      "sourceDuration": 18.2,
      "trimStart": 3.0,
      "role": "visual",
      "linkId": "linked-group-id",
      "volume": 1
    }
  ],
  "trackCounts": { "visual": 2, "audio": 2 },
  "captionTrack": null,
  "aslTrack": null
}
```

The timeline service enforces:

- account and project ownership for every referenced asset;
- exact base revision comparison;
- idempotent mutation responses keyed by tool-call ID;
- unique clip IDs and stable linked groups;
- non-negative start, trim, lane, and duration values;
- source bounds and a minimum clip duration;
- no overlap between clips on the same role and lane;
- atomic insert, move, trim, split, delete, replace, dub, volume, vision, caption-track, and ASL-track operations.

Manual edits and agent edits both consume canonical server results. A conflict stops the edit and requires a fresh timeline read rather than overwriting newer work.

## Accessibility pipelines

### Vision

Indexed visual moments provide the timestamps and scene evidence for audio description and spoken on-screen text. Gemini 3 Flash Preview creates bounded narration cues, Chirp 3 HD synthesizes each cue, and FFmpeg places the speech at the selected source times. Contrast and colour-safe variants use deterministic FFmpeg filters and become new GCS assets linked to their source.

### Hearing

Google Cloud Speech-to-Text V2 produces timed transcript cues. Captions remain attached to the selected canonical clip. ASL generation converts each transcript or description cue into one timing-preserving ASL gloss and validated CWASA-compatible gestural SiGML document. The viewer renders that track through a movable, keyboard-operable CWASA avatar. Noise reduction uses FFmpeg `afftdn`, preserves video when present, and registers the generated result as a new project asset.

### Deafblind

Liblouis translates the selected transcript through the `en-ueb-g2.ctb` table. Amplifier stores Unicode Braille, BRF text, and BRF timestamps on the timeline and can download the full track as `.brf`. Additional Deafblind operations attach structured descriptions, scene and speaker labels, navigation landmarks, large-print state, and deterministic tactile cues without replacing the original media.

### Sensory

Gemini Omni Flash edits selected video in bounded 9.5-second chunks for lower flash, lower motion, stabilization, fewer cuts, lower stimulation, or a nearly static alternative. FFmpeg normalizes each generated chunk back to its source duration, stitches the result, and restores the original selected audio. The derived video retains its source asset relationship and GCS generation.

### Language

Amplifier supports English, Spanish, French, German, Portuguese, Italian, Arabic, Hindi, Japanese, Korean, and Chinese targets. Chirp 3 diarizes source speech with word timestamps. Gemini profiles audible voice presentation for synthetic casting, Google Translation LLM translates one result per speaker turn, and Chirp 3 HD voices synthesize distinct speakers. FFmpeg fits each result to its original time window before the new audio track is added and the source dialogue is muted.

The same path translates captions or creates translated audio descriptions from indexed visual moments. Translation plans are cached in ClickHouse by project, source asset generation, action, language, and selected range.

## ClickHouse media memory

ClickHouse is the queryable media evidence layer, not the ownership or timeline authority.

### Tables

| Table | Engine and key | Purpose |
|---|---|---|
| `asset_search_index` | `ReplacingMergeTree(updated_at)` ordered by project and asset | Index status, searchable document, silence ranges, summary embedding, model and schema versions |
| `asset_search_moments` | `ReplacingMergeTree(updated_at)` ordered by project, asset, and moment | Timestamped descriptions, transcript text, thumbnails, 768-dimensional embeddings, and materialized search text |
| `asset_language_tracks` | `ReplacingMergeTree(updated_at)` ordered by source generation, action, language, and range | Reusable diarized turns and translated text plans |

`tokenbf_v1` indexes narrow exact text candidates before vector ranking. Gemini Embedding 2 stores 768-dimensional document and moment vectors. Search combines token evidence with cosine distance, then returns owned asset IDs and exact time ranges that Agent can place on the timeline.

### Scoped MCP

The ADK application connects to Amplifier's Streamable HTTP MCP server through `McpToolset`. It exposes four read-only tools:

- `clickhouse_search_project_moments`
- `clickhouse_read_project_transcript`
- `clickhouse_read_project_silence_ranges`
- `clickhouse_read_project_speaker_turns`

The tool context injects account, project, and internal MCP authentication headers. Every request rechecks account ownership and asset membership before querying ClickHouse. Raw SQL and cross-project identifiers are not exposed to agents.

## Media ingestion and indexing

Browser uploads use GCS resumable sessions in 8 MiB chunks. Bytes do not pass through Next.js or FastAPI. The completion request verifies the expected object size and uses FFprobe to make audio presence authoritative before the asset enters the project registry.

Moment Search is explicit. Activating it starts indexing for eligible project files and streams status through the originating request path. The indexer:

1. reads the owned GCS object;
2. extracts deterministic duration, frames, audio, and silence evidence;
3. creates timestamped visual or audio moments with Gemini 3 Flash Preview;
4. transcribes speech with Chirp 3 when audio is present;
5. renders durable preview frames into a versioned GCS prefix;
6. embeds compact documents and moments with Gemini Embedding 2;
7. writes versioned rows to ClickHouse.

Reload reads the durable ClickHouse state. A manual refresh performs one explicit status read; the application does not poll.

## Storage and ownership

```text
gs://amplifier-20260806-assets/
└── projects/{project id}/
    ├── assets/{asset id}/{file}
    ├── search/moments/v3/{asset id}/{preview}.jpg
    └── accessibility/
        ├── asl/v3/r2/{asset id}/{digest}.json
        └── speakers/
            ├── audio/v1/{asset}-{generation}.flac
            ├── voices/v1/{asset}-{generation}.json
            └── v4/{asset}-{generation}.json
```

Cloud SQL normalizes accounts, projects, assets, timelines, skills, and idempotency records. Authorization never trusts a client-authored project UUID or object key by itself. Media tools resolve the active account and project from authenticated server context, then resolve asset IDs through the project registry.

GCS objects are private. Uploads use origin-bound resumable sessions and `ifGenerationMatch=0`; derived objects record their source asset and operation in object metadata. The frontend reads owned media through an authenticated backend route.

## Streaming and chat state

The browser sends one authenticated project, session, selection, playhead, Timeline Shot, and attached-skill manifest with each agent turn. The backend streams:

- reasoning summaries;
- agent and specialist activation;
- tool calls and structured tool responses;
- Timeline Shot attachments;
- changed timeline ranges;
- generated chat titles;
- errors and completion.

Direct agents stream text tokens. Agent Engine tool workflows stream each ADK event through an incremental JSON adapter that handles fragmented adjacent events without waiting for the full run. Agent Engine Sessions stores managed ADK session state. Cloud SQL stores application and timeline state; one is never used as a substitute for the other.

Chats can be branched and deleted. After the first successful user/agent turn, Gemini 3 Flash Preview names the chat once and the title is stored in the ADK session. Skills are server-stored Markdown instructions attached per chat. They can narrow an agent's allowed tools but cannot grant authority outside the role's hard tool allowlist.

## Models and services

| Capability | Model or service | Output |
|---|---|---|
| Agent and specialists | `gemini-3.1-pro-preview` through Google ADK | Reasoning, tool calls, delegation, structured specialist results |
| Chat title | `gemini-3-flash-preview` | One persisted title after the first completed turn |
| Media understanding | `gemini-3-flash-preview` | Timestamped visual and audio moments |
| Embeddings | `gemini-embedding-2`, 768 dimensions | ClickHouse summary and moment vectors |
| Transcription and diarization | Google Cloud Speech-to-Text V2 `chirp_3` | Timed words, transcript cues, and speaker turns |
| Translation | Google Cloud Translation `general/translation-llm` | One translation per timed source turn |
| Speech synthesis | Google Cloud Text-to-Speech Chirp 3 HD | Descriptions and multi-speaker translated audio |
| ASL planning | `gemini-3.1-pro-preview` | Timing-preserving ASL gloss and validated gestural SiGML |
| Sensory video | `gemini-omni-flash-preview` | Edited video chunks normalized to source timing |
| Braille | Liblouis `en-ueb-g2.ctb` | Unicode Braille and BRF |
| Media processing | FFmpeg and FFprobe | Preview frames, filters, audio fitting, probing, and MP4 render |

## Export boundary

The current MP4 renderer composes visual and audio clips, trim ranges, lane timing, volume, contrast, and colour-safe settings into H.264/AAC output. Captions, transcripts, Braille, and ASL remain selectable synchronized timeline alternatives in the application. Captions and transcripts download as SRT, Braille downloads as BRF, and ASL plays through the viewer avatar; they are not currently burned into the MP4 export.

## Repository structure

```text
amplifier/
├── app/
│   ├── api/                 # Authenticated Next.js API boundary
│   ├── components/          # Editor, timeline, viewers, chat, skills, modes
│   ├── hooks/               # Canonical timeline and media-search state
│   └── lib/                 # Uploads, streaming, sessions, timeline documents
├── backend/
│   ├── app/
│   │   ├── agents/          # ADK roles, delegation, and tool policy
│   │   ├── tools/           # ClickHouse MCP servers
│   │   ├── agent_tools.py   # Typed project, timeline, and accessibility tools
│   │   ├── timeline_service.py
│   │   ├── media_indexing.py
│   │   ├── media_search.py
│   │   ├── language_tools.py
│   │   ├── vision_tools.py
│   │   ├── hearing_tools.py
│   │   ├── sensory_tools.py
│   │   ├── asl_tools.py
│   │   └── braille.py
│   ├── tests/               # Agent, timeline, indexing, ASL, language, Braille
│   └── requirements.txt
├── infra/
│   ├── Dockerfile.frontend
│   ├── Dockerfile.backend
│   ├── cloudbuild.frontend.yaml
│   ├── cloudbuild.backend.yaml
│   ├── deploy_agent_engine.py
│   └── gcs-cors.json
├── public/                  # Product and accessibility icons
└── package.json
```

## Local setup

### Requirements

- Node.js 22
- pnpm 10
- Python 3.12
- FFmpeg and FFprobe
- Liblouis with `lou_translate`
- Google Cloud Application Default Credentials
- a GCS bucket and Google Cloud project with Vertex AI, Speech-to-Text, Text-to-Speech, and Translation enabled
- ClickHouse for Moment Search, transcript evidence, and language-plan caching

On macOS:

```bash
brew install ffmpeg liblouis
gcloud auth application-default login
```

### Install

```bash
pnpm install

cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Frontend environment

Create `.env.local`:

```dotenv
AUTH_SECRET=replace-with-a-long-random-value
AMPLIFIER_BACKEND_URL=http://127.0.0.1:8000
AMPLIFIER_INTERNAL_SECRET=replace-with-the-same-backend-secret
```

### Backend environment

Create `backend/.env`:

```dotenv
GOOGLE_CLOUD_PROJECT=your-google-cloud-project
GOOGLE_CLOUD_LOCATION=global
GOOGLE_SPEECH_LOCATION=us
AMPLIFIER_GCS_BUCKET=your-private-gcs-bucket
AMPLIFIER_INTERNAL_SECRET=replace-with-the-same-frontend-secret

CLICKHOUSE_HOST=https://your-clickhouse-host
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=replace-with-clickhouse-password
CLICKHOUSE_DATABASE=amplifier

AMPLIFIER_AGENT_MODEL=gemini-3.1-pro-preview
AMPLIFIER_AGENT_MODEL_LOCATION=global
AMPLIFIER_BACKEND_ORIGIN=http://127.0.0.1:8000

# Required by Gemini Omni sensory video editing.
GEMINI_API_KEY=replace-with-gemini-api-key
```

SQLite is used when neither `AMPLIFIER_DATABASE_URL` nor `AMPLIFIER_DATABASE_SOCKET` is set. Production can use a PostgreSQL URL or Cloud SQL Unix socket through:

```dotenv
AMPLIFIER_DATABASE_URL=postgresql://user:password@host/database
# or
AMPLIFIER_DATABASE_USER=amplifier
AMPLIFIER_DATABASE_PASSWORD=replace-with-database-password
AMPLIFIER_DATABASE_NAME=amplifier
AMPLIFIER_DATABASE_SOCKET=/cloudsql/project:region:instance
```

### Run

Start the backend:

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload
```

Start the frontend in a second terminal:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The backend health route is [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health).

## Testing

```bash
pnpm build

cd backend
source .venv/bin/activate
python -m unittest discover -s tests
```

The backend suite covers agent construction and tool policy, canonical timeline behavior, managed Agent Engine streaming, media indexing, search efficiency, language timing, ASL validation, Braille output, and FFmpeg timeline rendering.

## Deployment

Production uses three independently scaled runtimes in Google Cloud project `amplifier-20260806`:

| Runtime | Region | Responsibility |
|---|---|---|
| `amplifier-frontend` | `africa-south1` | Next.js application, authentication, and browser API boundary |
| `amplifier-backend` | `africa-south1` | FastAPI, GCS, ClickHouse, Cloud SQL, FFmpeg, Speech, Translation, and tool gateway |
| `Amplifier Agent` | `europe-west1` | Warm Vertex AI Agent Engine application containing all ADK roles |

The backend container installs and verifies FFmpeg, FFprobe, and Liblouis during the image build. Cloud Run connects to PostgreSQL 16 through the Cloud SQL connector. Secrets are mounted from Secret Manager rather than stored in source or container images. The frontend and backend maintain warm minimum instances, startup CPU boost, and bounded concurrency appropriate to their workloads.

Build definitions live in `infra/cloudbuild.frontend.yaml` and `infra/cloudbuild.backend.yaml`. Agent Engine deployment is defined in `infra/deploy_agent_engine.py`. See [`infra/README.md`](infra/README.md) for the production runtime contract.

## Security and reliability

- Account IDs and project IDs are injected by authenticated server routes.
- Project and asset ownership are normalized in the application database.
- Raw GCS object keys never establish authorization.
- Upload sessions are origin-bound, resumable, and generation-protected.
- Agent tools use role allowlists and server-resolved project context.
- ClickHouse MCP tools are read-only and project-scoped.
- Timeline changes use validation, expected revisions, project locks, and idempotency records.
- GCS generations identify exact source versions used by caches and derived assets.
- Expected tool failures return structured results and remain visible in the stream.
- Status reconciliation uses request streams or explicit refresh; the application does not poll.
