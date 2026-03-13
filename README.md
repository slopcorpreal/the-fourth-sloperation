# The Fourth Sloperation — AI Podcast Forge

A Tauri desktop app for turning **huge textbooks** into chapter-based podcast episodes using:

- **Tauri** desktop shell (Rust + React)
- **ONNX Runtime (`ort`)** verification in the backend
- **Kokoro ONNX** synthesis path via `kokoro-onnx` Python package
- A configurable set of **free-tier LLM API providers** (BYO key)

---

## What this app does

1. Paste textbook text into the app.
2. Segment content into chapters (`Chapter`, `Unit`, `Part`, plus fallback chunking).
3. Generate one episode script per chapter using a selected provider.
4. Synthesize each script into WAV audio using Kokoro ONNX.

If no API key is provided, the app generates a local fallback script so the workflow still runs.

---

## Free provider set currently included

> Source inspiration for low-cost providers:  
> https://gist.githubusercontent.com/mcowger/892fb83ca3bbaf4cdc7a9f2d7c45b081/raw/ce2c58e7ba913b7d9091ba9c4851fe4bc62fd085/cheap.md

Current built-in choices (from UI):

- OpenRouter (free models list)
- Groq free tier
- Cloudflare Workers AI (free quota path)

All are OpenAI-compatible chat request shapes, so provider switching is straightforward.

---

## Prerequisites

### Base

- Node 20+
- Rust stable
- Tauri Linux dependencies (webkit2gtk/rsvg2/etc.) per: https://tauri.app/start/prerequisites/

### Kokoro synthesis

Install Python deps:

```bash
pip install kokoro-onnx soundfile
```

Download Kokoro model files (example names):

- `kokoro-v1.0.onnx`
- `voices-v1.0.bin`

Provide absolute paths in the app UI.

---

## Development

```bash
npm install
npm run dev
```

Desktop mode:

```bash
npm run tauri dev
```

Production web build:

```bash
npm run build
```

---

## Release CI + updater policy

This repository now ships desktop binaries through GitHub Releases via
`.github/workflows/release.yml`.

- Trigger: push to `main`/`master` (or manual `workflow_dispatch`)
- Build targets: macOS, Linux, Windows standalone Tauri bundles
- Auto updater feed: `https://github.com/slopcorpreal/the-fourth-sloperation/releases/latest/download/latest.json`

Versioning policy used by CI:

- **Major**: manually managed for initial release / massive refactors.
- **Minor**: automatic `git rev-list --count HEAD` commit count.
- **Patch**: reserved for local hotfix sequencing (currently fixed at `0` in CI releases).

Updater behavior in-app:

- Prompts for install when the **major version** increases.
- Prompts for install when the **minor version** increases (commit-count based releases/significant updates).
- Downloads and installs update package, then asks user to restart.

### Required secrets for signed updater artifacts

Set these repository secrets before enabling production releases:

- `TAURI_SIGNING_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional if your key has no password)

To generate a key pair locally:

```bash
npx tauri signer generate --ci --write-keys /tmp/updater.key
```

Then keep the private key secret and configure the public key in
the `TAURI_SIGNING_PUBLIC_KEY` repository secret (CI injects it into
`src-tauri/tauri.conf.json` at build time). The committed config keeps a
placeholder (`__SET_FROM_TAURI_SIGNING_PUBLIC_KEY_SECRET__`) intentionally.

---

## Architecture summary

- `src/App.tsx`  
  Main UI flow: ingest textbook, choose provider, generate scripts, synthesize chapter WAVs.

- `src/lib/podcast.ts`  
  Chapter segmentation logic, provider list, OpenAI-compatible request logic, fallback script generator.

- `src-tauri/src/lib.rs`  
  Tauri commands:
  - `check_ort_runtime` (initializes and reports ORT build info)
  - `synthesize_chapter_audio` (calls Python + `kokoro_onnx` to produce WAV files)

---

## Decision history / spec choices

1. **Tauri + React TS template chosen**  
   Keeps desktop distribution straightforward while enabling rapid UI iteration.

2. **Chapter-first segmentation strategy**  
   Large textbooks are context-heavy; chapter segmentation keeps prompts bounded and allows incremental generation.

3. **OpenAI-compatible provider abstraction**  
   A common request schema minimizes custom integration work and allows free-tier provider switching.

4. **Offline fallback script mode**  
   Guarantees a usable pipeline even without API credentials (helps testing and demos).

5. **Kokoro ONNX via Python bridge**  
   `kokoro-onnx` has practical usage examples in Python; a subprocess bridge minimizes Rust-side model/runtime complexity.

6. **Explicit ORT verification command**  
   `ort` is initialized from the Rust backend and exposed in UI so users can quickly confirm ONNX runtime availability.

7. **UI styling priority ("sexy" requirement)**  
   The interface uses a neon glassmorphism style while preserving readable form workflow for long-content processing.

---

## Notes on huge textbook handling

- Keep textbook chapter markers in input when possible.
- Tune “Max chapter characters” to match your provider context limits.
- For very large books, run generation in batches (chapters 1–5, 6–10, etc.) and synthesize incrementally.

---

## Security and privacy notes

- API keys are only used in runtime requests and not persisted to disk by app code.
- Kokoro synthesis runs local Python execution; verify model and voices files come from trusted sources.
- Provider prompts may leave your machine depending on provider selected.
