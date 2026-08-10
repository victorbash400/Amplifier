[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python_3.12-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Google ADK](https://img.shields.io/badge/Google_ADK-Gemini_3.1_Pro-4285F4?logo=google&logoColor=white)](https://google.github.io/adk-docs/)
[![Vertex AI](https://img.shields.io/badge/Vertex_AI-Agent_Engine-4285F4?logo=googlecloud&logoColor=white)](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/overview)
[![ClickHouse](https://img.shields.io/badge/ClickHouse-Media_Index_%2B_MCP-FFCC01?logo=clickhouse&logoColor=000000)](https://clickhouse.com/)
[![Cloud Run](https://img.shields.io/badge/Runtime-Google_Cloud_Run-4285F4?logo=googlecloud&logoColor=white)](https://cloud.google.com/run)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL_16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

# Amplifier

Amplifier is a media editor for making video, audio, and images accessible. A creator can work on a normal multi-track timeline and produce captions, transcripts, audio descriptions, spoken on-screen text, ASL, Braille, clearer audio, sensory-safe video, larger text, colour-safe visuals, and translated speech in the same project.

The editor can be used directly or through an agent. The agent can inspect project files, search inside indexed media, place an entire asset or an exact source moment, change the timeline, and call a specialist for the requested accessibility work. Generated audio, video, captions, ASL, and Braille return to the project rather than remaining as text in a conversation.

Built for the [Agentic Cinema: The Blockbuster Hackathon](https://agentic-cinema.devpost.com/).

[Open Amplifier](https://amplifier-frontend-102052243896.africa-south1.run.app) · [Local setup](#local-setup) · [Deployment](#deployment)

## How Amplifier works

An Amplifier project contains uploaded media, folders, generated assets, chats, skills, and one canonical timeline.

When a file is uploaded, the browser sends its bytes directly to a private Google Cloud Storage bucket through a resumable session. The backend completes the upload, verifies the object size, and uses FFprobe to record duration and whether the file contains audio. The account, project, asset ID, object key, and GCS generation are stored before any editor or agent tool can use the file.

Moment Search can then index the file. Gemini describes timed visual and audio moments, Speech-to-Text produces timed words, FFmpeg detects silence and creates previews, and Gemini Embedding 2 creates search vectors. ClickHouse stores that work so the editor and accessibility tools can reuse it.

A creator can edit the timeline manually or ask Agent for an outcome. Agent reads the active project and timeline, finds or places the relevant media, selects the correct clip, and performs structural edits itself. If the request needs captions, description, ASL, Braille, a sensory change, or translation, Agent delegates one bounded task to the matching specialist.

Every accepted edit returns a new canonical timeline revision. Captions and ASL remain timed to their source clip. Braille and transcripts can be downloaded. Generated audio and video become owned project assets that can be previewed, compared, placed, replaced, or removed without destroying the original.

## Architecture

Amplifier separates the browser application, media processing, agent runtime, application state, media storage, and media index.

```mermaid
flowchart LR
    Browser["Next.js editor"] --> API["FastAPI media backend"]
    Browser --> GCS["Google Cloud Storage"]
    API --> SQL["Cloud SQL PostgreSQL"]
    API --> GCS
    API --> CH["ClickHouse"]
    API --> Media["Gemini, Speech, Translation, TTS, FFmpeg, Liblouis"]
    API <--> Engine["Vertex AI Agent Engine"]
    Engine --> ADK["Google ADK agents"]
    ADK --> MCP["Project-scoped ClickHouse MCP"]
    MCP --> CH
```

The Next.js frontend and FastAPI backend run as separate Cloud Run services in `africa-south1`. PostgreSQL on Cloud SQL stores account and editor state. GCS stores original and generated media. ClickHouse stores the timed, searchable information extracted from that media. Vertex AI Agent Engine runs the Google ADK application in `europe-west1` and exchanges compact tool data with the backend; project media is not sent through Agent Engine.

## ClickHouse

### Why Amplifier needs a media index

A filename does not explain what happens inside a recording. Sending a complete video back through a model whenever a creator needs captions, a scene, a description, or a translation would repeat expensive work and slow down every feature.

Amplifier indexes media once and stores the reusable result in ClickHouse. That index answers both search questions and accessibility questions. It can identify the exact seconds containing a visual event, return a timed transcript, supply quiet ranges for narration, provide visual evidence for audio description, and reuse speaker turns and translations.

ClickHouse is used for four active jobs:

1. It records the state and result of media indexing.
2. It stores timed multimodal moments for exact and semantic search.
3. It supplies transcripts, descriptions, silence, and speakers to agents and accessibility tools.
4. It caches speaker-aware language plans against the exact source version and selected range.

### Data model

`asset_search_index` stores one current indexing record per project asset. It contains the asset name and type, indexing status and stage, a compact searchable document, silence ranges, a summary embedding, schema and model versions, the last error, and the update time.

`asset_search_moments` stores the moments inside each asset. Every row includes a stable moment ID, source start and end, visual description, transcript text, preview key, content type, model versions, and a normalized 768-dimensional Gemini Embedding 2 vector.

`asset_language_tracks` stores reusable speaker turns and translated text. Its key includes the project, source asset and GCS generation, accessibility action, target language, and selected start and end. If the source object or selected range changes, the old language plan is not reused.

All three tables use `ReplacingMergeTree(updated_at)`. Reads use `FINAL` when the latest logical record is required. Project and asset identity lead the `ORDER BY` keys so the common editor queries remain scoped to the active project. Repeated categorical fields such as status, content type, language, action, and model use `LowCardinality` columns.

The moments table also has a materialized `search_text` column built from the asset name, description, and transcript. `tokenbf_v1` indexes cover the searchable document, descriptions, transcripts, and combined search text. Set indexes cover status, content type, language, and action.

### Hybrid moment search

A query is embedded with Gemini Embedding 2 using the retrieval-query task type. ClickHouse first uses `hasAllTokens` and the token indexes to identify exact lexical candidates. It then calculates `cosineDistance` against the stored moment vectors, gives exact token matches a small score boost, and returns the strongest moments with their asset ID, preview, transcript, description, score, and exact source seconds.

The implementation deliberately uses exact vector scoring after lexical candidate reduction rather than claiming a native ANN index. The moment embeddings are normalized before insertion, and document embeddings are generated in batches of up to 100 inputs. Moment rows are inserted together instead of issuing one insert for each moment.

Search results are editing inputs. Agent can take the returned asset and source range and insert only those seconds on the timeline. Vision can query overlapping visual moments when producing audio description or spoken on-screen text. ASL can read timed transcript or description cues. Hearing and Deafblind can reuse the transcript for captions, ASL, Braille, and structure.

### Language cache

Speaker-aware translation has several expensive stages: audio extraction, diarization, speaker turns, translation, voice selection, synthesis, and timing. ClickHouse stores the reusable planning portion in `asset_language_tracks`.

A cache lookup must match the source asset, GCS generation, action, language, and selected time range. A hit returns the same ordered speaker turns and translated turns. A miss runs the language planning pass and saves its result for later caption, dialogue, or description translation.

### Agent access through MCP

The active Google ADK agents receive a custom Streamable HTTP MCP toolset backed by ClickHouse. It exposes four read-only operations:

- `clickhouse_search_project_moments`
- `clickhouse_read_project_transcript`
- `clickhouse_read_project_silence_ranges`
- `clickhouse_read_project_speaker_turns`

This is not raw database access. ADK injects the active account, project, and internal MCP secret into each request. The MCP server verifies project ownership and asset membership in the application database before querying ClickHouse. The model cannot choose another account scope or submit arbitrary SQL.

The FastAPI service uses the asynchronous `clickhouse-connect` client over TLS for runtime commands, inserts, and parameterized queries. The project also contains a generic `mcp-clickhouse` CLI toolset for database discovery and read-only query development, but the production agents use the narrower HTTP MCP surface described above.

Index status also lives in ClickHouse. Reloading the editor reads `indexing`, `ready`, or `failed`, along with the current stage, error, and update time. If a process ended while an asset was marked as indexing and no active in-process lock remains, the backend reports it as interrupted so the user can explicitly retry. Amplifier does not poll; status arrives through the indexing request, reload, or manual refresh.

## Agent system

Amplifier runs one Google ADK application using `gemini-3.1-pro-preview`. Agent owns project inspection, media retrieval, and structural timeline editing. Five task agents handle accessibility domains:

- Vision creates audio description, spoken on-screen text, larger text, contrast changes, and colour-safe media.
- Hearing creates transcripts, captions, ASL, and noise-reduced media.
- Deafblind creates Braille, BRF, structured descriptions, labels, navigation, large-print state, and tactile cues.
- Sensory creates reduced-flash, reduced-motion, stabilized, fewer-cut, lower-stimulation, and nearly static video.
- Language translates captions, spoken dialogue, and audio descriptions while preserving speaker turns and timing.

Each agent receives a role-specific tool allowlist. Agent can browse owned files, inspect assets, query ClickHouse, insert exact moments, select clips, and move, trim, split, delete, replace, or mix media. Specialists receive shared read tools, the scoped ClickHouse MCP, and only the mutation tools belonging to their accessibility domain.

Agent prepares the timeline before delegation. It places missing media, selects the canonical clip, and sends one bounded task to one specialist. A specialist returns either `completed` with the resulting revision or `blocked` with a concrete prerequisite. It cannot delegate again.

Before a timeline mutation, an agent reads a Timeline Shot. This is a compact JSON representation of the project ID, timeline revision, playhead, selection, clips, asset IDs, roles, lanes, start times, source trims, durations, linked audio and video, track counts, captions, and ASL state. It gives the model the current edit without sending the complete project or full-resolution media on every turn.

Tool calls return structured success or failure results. Expected failures include an error code, message, retryability, field details, current revision, and any action the agent can take. Successful mutations return the complete new timeline and the changed time and lane range.

## Timeline and application state

PostgreSQL is the authority for users, projects, assets, timelines, skills, chat metadata, and idempotency records. SQLite implements the same application contract for local development when no PostgreSQL connection is configured.

Each project has one timeline document containing its revision, clips, visual and audio track counts, caption track, and ASL track. A clip records its owned asset ID, role, lane, start, duration, source duration, trim start, volume, optional linked-group ID, and visual adjustments.

Every mutation includes the timeline revision it started from and an idempotency key derived from the tool call. The backend locks the project, verifies the revision, checks every referenced asset against the account-owned registry, applies the operation, validates the complete result, and commits one new revision. A repeated tool call returns its recorded response. A stale revision returns a conflict instead of overwriting newer work.

The validator rejects unknown assets, duplicate clip IDs, negative times, invalid lanes, source overruns, clips below the minimum duration, and overlapping clips on the same role and lane. Linked audio and video are moved, trimmed, split, replaced, and deleted together unless the requested operation explicitly targets one track.

Manual edits and agent edits use the same timeline service and receive the same canonical response. This keeps the browser, renderer, and agents on one document instead of maintaining separate editor states.

## Accessibility pipelines

### Vision

Audio description and spoken on-screen text start from the visual moments already stored in ClickHouse. Gemini 3 Flash Preview turns that evidence into bounded narration cues. Chirp 3 HD synthesizes the cue text, and FFmpeg places each cue at its source time. Contrast and colour-safe operations use deterministic FFmpeg filters and register the result as a new GCS asset linked to the source.

### Hearing and ASL

Speech-to-Text V2 with `chirp_3` creates timed words and transcript cues. Captions remain attached to the selected canonical clip. Noise reduction uses FFmpeg `afftdn`, preserves video when present, and creates a new owned asset.

ASL uses transcript or description cues without changing their IDs or timestamps. Gemini 3.1 Pro Preview produces an ASL gloss and CWASA-compatible gestural SiGML for every cue. The backend validates the XML structure, supported elements, cue identity, and timing before saving the track. The viewer plays the result through a movable, keyboard-operable CWASA avatar.

### Deafblind

Liblouis translates timed text through the `en-ueb-g2.ctb` table. Amplifier stores Unicode Braille, BRF text, and BRF timestamps, and the viewer can download the complete `.brf` file. Other Deafblind operations attach structured descriptions, visual and sound descriptions, scene and speaker labels, navigation points, large-print state, and tactile cue information.

### Sensory

Gemini Omni Flash edits selected video in 9.5-second sections for less flashing, movement, camera shake, rapid cutting, or stimulation. FFmpeg normalizes every generated section to the source duration, joins the result, and restores the selected source audio. A nearly static option creates a calmer version while retaining the original timing.

### Language

Amplifier currently supports English, Spanish, French, German, Portuguese, Italian, Arabic, Hindi, Japanese, Korean, and Chinese targets.

The backend converts selected audio to mono 16 kHz FLAC before sending it to Speech-to-Text. Chirp 3 returns word timestamps and speaker labels. Gemini profiles audible voice presentation for synthetic casting, Google Translation LLM translates one result per speaker turn, and Chirp 3 HD gives different speakers stable voices. FFmpeg adjusts speaking rate and fits each synthesized turn into its original window before the new audio is added to the timeline.

The same language path can translate captions or create translated audio descriptions from indexed visual moments. ClickHouse prevents repeated diarization and translation planning when the source generation, range, action, and language have not changed.

## Uploads, storage, and ownership

Browser uploads use GCS resumable sessions in 8 MiB chunks, so media bytes do not pass through Next.js or FastAPI. Sessions are bound to the browser origin and create new objects with `ifGenerationMatch=0`. Completion verifies object size and FFprobe metadata before the application registers the asset.

Source media lives under `projects/{project_id}/assets/{asset_id}/`. Search previews use versioned moment paths. ASL plans, speaker audio, voice profiles, language artifacts, sensory edits, descriptions, and other generated files use project- and source-specific keys.

GCS object paths do not establish authorization. The authenticated account and active project come from the server session. Media routes and tools resolve an asset ID through the application database and confirm its account and project before reading its object key. Derived objects record their source asset, action, and generation in metadata where applicable.

## Streaming, chats, and skills

Agent runs stream through FastAPI and Next.js as server-sent events. The event stream includes text, reasoning summaries, tool calls, tool results, active specialist changes, Timeline Shot attachments, changed timeline ranges, errors, and completion. An incremental Agent Engine adapter handles fragmented adjacent JSON events without waiting for the full run to finish.

Agent Engine Sessions stores ADK conversation events and state. PostgreSQL stores application-owned chat metadata. After the first successful user and agent turn, Gemini 3 Flash Preview creates one chat title. Chats can be branched and deleted.

Skills are Markdown instructions stored per account and attached per chat. A skill can narrow the tools available for a task and add workflow guidance, but it cannot grant a tool outside the selected agent's hard allowlist or change account and project authority.

## Models and services

| Capability | Model or service |
|---|---|
| Agent and specialists | Google ADK with `gemini-3.1-pro-preview` |
| Chat titles and media understanding | `gemini-3-flash-preview` |
| Media vectors | `gemini-embedding-2`, 768 dimensions |
| Transcription and diarization | Speech-to-Text V2 `chirp_3` |
| Translation | Google Cloud Translation `general/translation-llm` |
| Speech synthesis | Google Cloud Text-to-Speech Chirp 3 HD |
| ASL planning | `gemini-3.1-pro-preview` and validated gestural SiGML |
| Sensory video | `gemini-omni-flash-preview` |
| Braille | Liblouis `en-ueb-g2.ctb` |
| Media processing | FFmpeg and FFprobe |
| Media index and agent evidence | ClickHouse and project-scoped MCP |
| Application state | PostgreSQL 16 on Cloud SQL |
| Media storage | Google Cloud Storage |

## Export behavior

The MP4 renderer currently composes visual and audio clips, source trims, lane timing, volume, contrast, and colour-safe settings into H.264/AAC output. Captions, transcripts, Braille, and ASL remain selectable synchronized alternatives in the application. Captions and transcripts can download as SRT, Braille as BRF, and ASL plays through the viewer avatar; these tracks are not currently burned into the MP4.

## Repository structure

```text
amplifier/
├── app/                    # Next.js routes, editor, timeline, viewers, chat, and skills
├── backend/
│   ├── app/
│   │   ├── agents/         # ADK roles, delegation, and tool policy
│   │   ├── tools/          # Scoped and generic ClickHouse MCP integrations
│   │   ├── agent_tools.py  # Project, timeline, and accessibility tool contracts
│   │   ├── media_search.py # ClickHouse indexing and hybrid moment search
│   │   ├── timeline_service.py
│   │   ├── vision_tools.py
│   │   ├── hearing_tools.py
│   │   ├── language_tools.py
│   │   ├── sensory_tools.py
│   │   ├── asl_tools.py
│   │   └── braille.py
│   ├── tests/
│   └── requirements.txt
├── infra/                  # Cloud Build, Cloud Run containers, Agent Engine deployment
├── public/
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
- a GCS bucket
- ClickHouse
- Google Cloud APIs for Vertex AI, Speech-to-Text, Text-to-Speech, and Translation

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
AUTH_URL=http://localhost:3000
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

CLICKHOUSE_HOST=your-clickhouse-host
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=replace-with-clickhouse-password
CLICKHOUSE_DATABASE=amplifier

AMPLIFIER_AGENT_MODEL=gemini-3.1-pro-preview
AMPLIFIER_AGENT_MODEL_LOCATION=global
AMPLIFIER_BACKEND_ORIGIN=http://127.0.0.1:8000

GEMINI_API_KEY=replace-with-gemini-api-key
```

SQLite is used when neither `AMPLIFIER_DATABASE_URL` nor `AMPLIFIER_DATABASE_SOCKET` is configured. PostgreSQL can use a normal connection URL or a Cloud SQL Unix socket:

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

Start the frontend in another terminal:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The backend health route is [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health), and ClickHouse health is [http://127.0.0.1:8000/clickhouse/health](http://127.0.0.1:8000/clickhouse/health).

## Testing

```bash
pnpm lint
pnpm build

cd backend
source .venv/bin/activate
python -m unittest discover -s tests
```

The backend suite covers agent construction and tool policy, timeline revisions and validation, Agent Engine streaming, indexing, hybrid search efficiency, language timing, ASL validation, Braille, production runtime configuration, and FFmpeg rendering.

## Deployment

Production uses three independently scaled runtimes in Google Cloud project `amplifier-20260806`:

- `amplifier-frontend` runs Next.js, Auth.js, and the browser API boundary in `africa-south1`.
- `amplifier-backend` runs FastAPI, FFmpeg, FFprobe, Liblouis, media integrations, ClickHouse access, Cloud SQL access, and the agent tool gateway in `africa-south1`.
- `Amplifier Agent` runs the Google ADK application on Vertex AI Agent Engine in `europe-west1`.

The frontend and backend images are built with `infra/cloudbuild.frontend.yaml` and `infra/cloudbuild.backend.yaml`. The backend container verifies FFmpeg, FFprobe, and Liblouis during its image build. Agent Engine deployment is defined in `infra/deploy_agent_engine.py`.

Cloud Run uses service-specific identities. Secrets are mounted from Secret Manager. The backend connects to PostgreSQL through the Cloud SQL connector. The frontend sets a canonical `AUTH_URL` so Auth.js never uses the container's internal bind address for browser redirects. See [`infra/README.md`](infra/README.md) for the production runtime contract.

## Security and reliability

- Accounts, projects, and assets are normalized in the application database.
- Authenticated server routes inject account and project context.
- GCS object keys never establish authorization by themselves.
- Upload sessions are resumable, origin-bound, and generation-protected.
- Timeline mutations use project locks, expected revisions, validation, and idempotency records.
- Agent tools use role allowlists and server-resolved project context.
- ClickHouse MCP tools are read-only, authenticated, and project-scoped.
- ClickHouse queries use typed parameters rather than model-generated SQL.
- GCS generations identify the exact source used by caches and generated assets.
- Tool failures remain visible as structured results.
- Long agent work streams through SSE; status refresh is request-driven or manual rather than polling.
