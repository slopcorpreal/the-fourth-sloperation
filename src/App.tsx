import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import {
  buildOfflineFallbackScript,
  FREE_LLM_PROVIDERS,
  generateChapterScriptWithProvider,
  splitTextbookIntoChapters,
  type ChapterScript,
} from "./lib/podcast";

function App() {
  const [textbookText, setTextbookText] = useState("");
  const [chapterMaxLength, setChapterMaxLength] = useState(12000);
  const [providerId, setProviderId] = useState(FREE_LLM_PROVIDERS[0].id);
  const [apiKey, setApiKey] = useState("");
  const [modelOverride, setModelOverride] = useState("");
  const [kokoroModelPath, setKokoroModelPath] = useState("");
  const [kokoroVoicesPath, setKokoroVoicesPath] = useState("");
  const [voice, setVoice] = useState("af_sarah");
  const [speed, setSpeed] = useState("1.0");
  const [outputDirectory, setOutputDirectory] = useState("./output");
  const [statusMessage, setStatusMessage] = useState("");
  const [scripts, setScripts] = useState<ChapterScript[]>([]);
  const [busy, setBusy] = useState(false);

  const selectedProvider = useMemo(
    () => FREE_LLM_PROVIDERS.find((provider) => provider.id === providerId)!,
    [providerId],
  );

  const chapters = useMemo(
    () => splitTextbookIntoChapters(textbookText, chapterMaxLength),
    [chapterMaxLength, textbookText],
  );

  async function generateScripts() {
    if (!chapters.length) {
      setStatusMessage("Paste textbook content first so chapters can be created.");
      return;
    }

    setBusy(true);
    setStatusMessage("Generating podcast script...");
    try {
      const model = modelOverride.trim() || selectedProvider.defaultModel;
      const generatedScripts: ChapterScript[] = [];

      for (const chapter of chapters) {
        if (!apiKey.trim()) {
          generatedScripts.push(buildOfflineFallbackScript(chapter));
          continue;
        }

        try {
          generatedScripts.push(
            await generateChapterScriptWithProvider(
              chapter,
              selectedProvider,
              apiKey.trim(),
              model,
            ),
          );
        } catch {
          generatedScripts.push(buildOfflineFallbackScript(chapter));
        }
      }

      setScripts(generatedScripts);
      setStatusMessage(
        `Done. ${generatedScripts.length} chapter episode scripts prepared.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function runOrtCheck() {
    const response = await invoke<{ initialized: boolean; buildInfo: string }>(
      "check_ort_runtime",
    );
    setStatusMessage(
      `ORT initialized: ${response.initialized ? "yes" : "no"} | ${response.buildInfo}`,
    );
  }

  async function synthesizeChapter(script: ChapterScript) {
    setBusy(true);
    setStatusMessage(`Synthesizing ${script.chapter.title} with Kokoro...`);
    try {
      const result = await invoke<{ outputPath: string }>("synthesize_chapter_audio", {
        request: {
          chapterIndex: script.chapter.index,
          chapterTitle: script.chapter.title,
          chapterScript: script.script,
          modelPath: kokoroModelPath,
          voicesPath: kokoroVoicesPath,
          voice,
          speed: Number(speed),
          outputDirectory,
        },
      });
      setStatusMessage(`Created audio: ${result.outputPath}`);
    } catch (error) {
      setStatusMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <header>
        <p className="badge">The Fourth Sloperation</p>
        <h1>Sexy AI Podcast Forge</h1>
        <p className="subhead">
          Feed in a huge textbook, segment by chapter, generate chapter scripts, then
          synthesize narration with Kokoro ONNX.
        </p>
      </header>

      <section className="panel">
        <h2>1) Textbook input</h2>
        <textarea
          value={textbookText}
          onChange={(event) => setTextbookText(event.currentTarget.value)}
          placeholder="Paste your textbook text here. Tip: keep chapter headings like 'Chapter 1 ...' intact."
        />
        <label>
          Max chapter characters
          <input
            type="number"
            min={1000}
            max={40000}
            value={chapterMaxLength}
            onChange={(event) => setChapterMaxLength(Number(event.currentTarget.value))}
          />
        </label>
        <p>{chapters.length} chapter segments ready.</p>
      </section>

      <section className="panel">
        <h2>2) LLM provider</h2>
        <label>
          Provider
          <select
            value={providerId}
            onChange={(event) => setProviderId(event.currentTarget.value)}
          >
            {FREE_LLM_PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          API key (optional, fallback script is used when omitted)
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.currentTarget.value)}
            placeholder="sk-..."
          />
        </label>
        <label>
          Model override
          <input
            value={modelOverride}
            onChange={(event) => setModelOverride(event.currentTarget.value)}
            placeholder={selectedProvider.defaultModel}
          />
        </label>
        <p className="hint">
          {selectedProvider.notes}{" "}
          <a href={selectedProvider.docsUrl} target="_blank" rel="noreferrer">
            docs
          </a>
        </p>
      </section>

      <section className="panel">
        <h2>3) Kokoro ONNX audio</h2>
        <label>
          model.onnx path
          <input
            value={kokoroModelPath}
            onChange={(event) => setKokoroModelPath(event.currentTarget.value)}
            placeholder="/absolute/path/to/kokoro-v1.0.onnx"
          />
        </label>
        <label>
          voices.bin path
          <input
            value={kokoroVoicesPath}
            onChange={(event) => setKokoroVoicesPath(event.currentTarget.value)}
            placeholder="/absolute/path/to/voices-v1.0.bin"
          />
        </label>
        <div className="row">
          <label>
            voice
            <input value={voice} onChange={(event) => setVoice(event.currentTarget.value)} />
          </label>
          <label>
            speed
            <input value={speed} onChange={(event) => setSpeed(event.currentTarget.value)} />
          </label>
          <label>
            output dir
            <input
              value={outputDirectory}
              onChange={(event) => setOutputDirectory(event.currentTarget.value)}
            />
          </label>
        </div>
      </section>

      <section className="actions">
        <button disabled={busy} onClick={generateScripts}>
          Generate chapter podcast scripts
        </button>
        <button disabled={busy} onClick={runOrtCheck}>
          Check ORT runtime
        </button>
      </section>

      <section className="panel">
        <h2>Scripts</h2>
        {scripts.length === 0 ? (
          <p className="hint">No scripts yet. Generate to preview chapter episodes.</p>
        ) : (
          <ul className="scripts">
            {scripts.map((script) => (
              <li key={`${script.chapter.index}-${script.chapter.title}`}>
                <div className="script-head">
                  <h3>{script.chapter.title}</h3>
                  <button
                    disabled={
                      busy || !kokoroModelPath.trim() || !kokoroVoicesPath.trim()
                    }
                    onClick={() => synthesizeChapter(script)}
                  >
                    Synthesize audio
                  </button>
                </div>
                <p className="meta">Provider: {script.provider}</p>
                <pre>{script.script}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="status">{statusMessage}</p>
    </main>
  );
}

export default App;
