# Threadwise

A private Eve assistant for any call. Share meeting-tab audio and your microphone, or paste a transcript, to receive live coaching. Calls have durable transcripts and an attached memory space for notes, reference text, and remembered conversations.

## Use

1. Unlock the app with the operator password.
2. Choose **General** or create a memory space for a client, project, or topic.
3. Add notes or reference text, if useful. Empty memory works too.
4. Start a call. Its memory attachment stays fixed; changing the selector applies to the next new call.
5. Select **Share meeting audio**, then share the meeting tab with audio enabled and allow microphone access. Keep the separate audio window open.
6. Stop audio and let pending speech save. **Remember this call** makes its saved transcript available to later calls in the same memory space. Repeat after further conversation to update the snapshot.

Notes and documents are recalled on subsequent analysis turns. Recent remembered transcripts are supplied as bounded excerpts. The agent can search older memory for detailed questions. Memory stores reported information with sources; it does not convert suggestions into agreements or independently verified facts. Calls and coaching remain archived even when a call is not added to shared memory.

**Summarise call** requests a full review; **Download Markdown** exports the saved conversation and coaching. Automatic speech suggestions use a short response path; typed questions can request detailed analysis.

## Call capture

The current transport listens through desktop Chrome 135+ browser audio sharing. It does **not** join a meeting as a separate participant or speak to participants. Native desktop meeting apps and mobile browsers are not supported by tab capture; use the meeting's browser tab or paste transcript text. A meeting-bot service would be a separate integration.

The browser mixes tab audio and microphone input and passes that track to speech recognition. Video is not sent or saved, and raw audio is not archived by the app. The browser's speech service may process audio remotely. Mixed audio does not reliably identify speakers. Let participants know before capture.

The dashboard can refresh while the separate audio window continues capturing. Refreshing the audio window requires selecting the meeting tab again. Pending segments are restored from session storage; closing that window can lose unsent speech. Stop capture and let the queue save before closing.

## Memory and privacy

One operator password protects every data/model route. Everyone given that password shares the same workspace. Memory spaces separate context; they are not separate user accounts or an authorization boundary between people.

On Vercel, data stays in a private Blob store under `callweave/`:

- `memories/<memory-id>/` — space metadata, reference documents, notes, and remembered call snapshots.
- `calls/<call-id>/` — transcripts, coaching, status, and the fixed memory attachment.

New installations start empty. Add your own context through the authenticated interface or the text/Markdown import command. No client-specific data is bundled.

Memory recall is bounded to recent notes, document excerpts, and five remembered calls. `search_memory` performs literal text search with paginated results; it is not semantic vector search. Original source documents, passwords, call records, and Blob credentials must stay outside Git. There is currently no automatic retention expiry or in-app deletion interface.

## Develop

Requires Node.js 24+.

```sh
npm ci
cp .env.example .env.local
# Set COPILOT_PASSWORD and model access. For hosted storage, configure a private BLOB_READ_WRITE_TOKEN.
npm run dev
```

Local storage defaults to `.data/` when no Blob token is set. Vercel requires private Blob storage. String model IDs use AI Gateway with project OIDC or a local `AI_GATEWAY_API_KEY`.

Paste reference text or load `.txt`/`.md` files in the memory panel. Command-line import:

```sh
npm run knowledge:sync -- general ./context.md
# Or replace general with a memory UUID created in the app.
```

Each document supports up to 100,000 characters. Convert PDFs or office documents to text first.

```sh
npm test
npm run typecheck
npm run build
```

The app uses Eve 0.52.2 and Claude Sonnet 5. Call sessions have a four-hour lifetime; a budget continuation control appears when needed. Saved transcripts remain after an Eve session expires. The public sign-in shell contains no saved memory or call data.

## Integration API

All endpoints below require `Authorization: Bearer <COPILOT_PASSWORD>`; browser writes must be same-origin.

- `GET/POST /api/memories` — list/create spaces (`{id: UUID, name}`).
- `GET /api/knowledge?memoryId=<id>` — inspect attached memory.
- `POST /api/knowledge/notes` — `{id: UUID, memoryId, text}`.
- `POST /api/knowledge/documents` — `{id: UUID, memoryId, name, text}`.
- `POST /api/calls` — `{id: UUID, title, memoryId}`; omitted memory defaults to General.
- `POST /api/calls/:id/segments` — `{segments: [{id: UUID, text, source, capturedAt: ISO8601}], mode}`. Modes: `save`, `suggest`, `analyse` (default).
- `POST /api/calls/:id/remember` — retain a snapshot of saved transcript evidence in the call's memory space.

Use one ordered transcript producer per call. Segment IDs deduplicate ordinary retries; ambiguous failure between Eve accepting a message and recording delivery can repeat analysis. There are no tools that send messages or modify external accounts.
