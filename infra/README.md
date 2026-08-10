# Amplifier Google Cloud deployment

Amplifier uses three production runtimes in project `amplifier-20260806`:

- `amplifier-frontend`: Next.js on Cloud Run in `africa-south1`.
- `amplifier-backend`: FastAPI, FFmpeg, FFprobe, Liblouis, GCS, ClickHouse, and Cloud SQL on Cloud Run in `africa-south1`.
- `Amplifier Agent`: one warm Vertex AI Agent Engine application in `europe-west1` containing Agent and the Vision, Hearing, Deafblind, Sensory, and Language task agents.

Cloud SQL PostgreSQL is authoritative for accounts, workspaces, projects, assets, timelines, idempotency records, and skills. Agent Engine Sessions is authoritative for ADK conversation events and state. GCS stores immutable source and generated media. ClickHouse remains the project-scoped search, transcript, speaker, silence, and cache surface.

Agent Engine never processes media bytes. Its typed ADK tools call the authenticated backend tool gateway and receive canonical timeline revisions and structured errors. The browser receives the same SSE event contract through the frontend and backend.

The backend keeps one instance warm with instance-based CPU because upload indexing can continue after the upload-complete request. Agent Engine keeps one instance warm. Both Cloud Run services use startup CPU boost. Media remains in `africa-south1`; only compact tool JSON crosses to Agent Engine in `europe-west1`.

The container builds are defined in `cloudbuild.backend.yaml` and `cloudbuild.frontend.yaml`. `Dockerfile.backend` validates FFmpeg, FFprobe, and Liblouis at build time. Secrets are mounted from Secret Manager and are not stored in images or source.
