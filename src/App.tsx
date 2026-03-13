import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import {
  buildOfflineFallbackScript,
  FREE_LLM_PROVIDERS,
  generateChapterScriptWithProvider,
  splitTextbookIntoChapters,
  type ChapterScript,
} from "./lib/podcast";

const STEP_TITLES = [
  "Add textbook content",
  "Choose chapters",
  "Configure AI + voices",
  "Generate scripts",
  "Listen + synthesize",
] as const;

function App() {
  const [currentStep, setCurrentStep] = useState(0);
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
  const [selectedChapterIndexes, setSelectedChapterIndexes] = useState<number[]>([]);
  const hasInitializedSelection = useRef(false);

  const selectedProvider = useMemo(
    () => FREE_LLM_PROVIDERS.find((provider) => provider.id === providerId)!,
    [providerId],
  );

  const chapters = useMemo(
    () => splitTextbookIntoChapters(textbookText, chapterMaxLength),
    [chapterMaxLength, textbookText],
  );

  useEffect(() => {
    setSelectedChapterIndexes((previousIndexes) => {
      if (chapters.length === 0) {
        return [];
      }

      if (!hasInitializedSelection.current) {
        hasInitializedSelection.current = true;
        return chapters.map((chapter) => chapter.index);
      }

      const availableIndexes = new Set(chapters.map((chapter) => chapter.index));
      return previousIndexes.filter((index) => availableIndexes.has(index));
    });
  }, [chapters]);

  const selectedChapters = useMemo(
    () =>
      chapters.filter((chapter) =>
        selectedChapterIndexes.includes(chapter.index),
      ),
    [chapters, selectedChapterIndexes],
  );

  const maxUnlockedStep = useMemo(() => {
    if (chapters.length === 0) return 0;
    if (selectedChapters.length === 0) return 1;
    if (!kokoroModelPath.trim() || !kokoroVoicesPath.trim()) return 2;
    if (scripts.length === 0) return 3;
    return 4;
  }, [
    chapters.length,
    kokoroModelPath,
    kokoroVoicesPath,
    scripts.length,
    selectedChapters.length,
  ]);

  function openStep(step: number) {
    if (step <= maxUnlockedStep) {
      setCurrentStep(step);
    }
  }

  function toggleChapter(index: number) {
    setSelectedChapterIndexes((previousIndexes) =>
      previousIndexes.includes(index)
        ? previousIndexes.filter((chapterIndex) => chapterIndex !== index)
        : [...previousIndexes, index],
    );
  }

  function selectAllChapters() {
    setSelectedChapterIndexes(chapters.map((chapter) => chapter.index));
  }

  function clearChapterSelection() {
    setSelectedChapterIndexes([]);
  }

  async function generateScripts() {
    if (!selectedChapters.length) {
      setStatusMessage("Choose at least one chapter before generating scripts.");
      return;
    }

    setBusy(true);
    if (currentStep < 3) {
      setCurrentStep(3);
    }
    setStatusMessage("Generating podcast scripts...");
    try {
      const model = modelOverride.trim() || selectedProvider.defaultModel;
      const generatedScripts: ChapterScript[] = [];

      for (const chapter of selectedChapters) {
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
        `Done. ${generatedScripts.length} episode scripts are ready for voice synthesis.`,
      );
      if (currentStep < 4) {
        setCurrentStep(4);
      }
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

  const onboardingItems = [
    {
      label: "Paste your textbook and confirm chapters were detected.",
      done: chapters.length > 0,
    },
    {
      label: "Pick at least one chapter to convert into episodes.",
      done: selectedChapters.length > 0,
    },
    {
      label: "Optional: add API key/model override for richer scripts.",
      done: Boolean(apiKey.trim() || modelOverride.trim()),
    },
    {
      label: "Add Kokoro model + voices paths for local narration.",
      done: Boolean(kokoroModelPath.trim() && kokoroVoicesPath.trim()),
    },
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="logo">
          <span className="logo-icon">🎙</span>
          <div>
            <p className="logo-title">The Fourth Sloperation</p>
            <p className="logo-subtitle">Podcast forge for regular humans</p>
          </div>
        </div>
        <div className="status-pills">
          <span className={apiKey.trim() ? "pill ok" : "pill warn"}>
            {apiKey.trim() ? "API key connected" : "No API key (offline mode active)"}
          </span>
          <span className="pill neutral">
            {busy ? "Working..." : `${scripts.length} scripts ready`}
          </span>
        </div>
      </header>

      <aside className="sidebar">
        <p className="sidebar-title">Onboarding steps</p>
        <ol className="step-list">
          {STEP_TITLES.map((title, index) => {
            const done = index < currentStep;
            const active = index === currentStep;
            const locked = index > maxUnlockedStep;
            return (
              <li key={title}>
                <button
                  className={`step-item ${done ? "done" : ""} ${active ? "active" : ""}`}
                  disabled={locked}
                  onClick={() => openStep(index)}
                >
                  <span className="step-num">{done ? "✓" : index + 1}</span>
                  <span>{title}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="sidebar-box">
          <p className="sidebar-box-title">Quick setup checklist</p>
          <ul>
            {onboardingItems.map((item) => (
              <li key={item.label} className={item.done ? "done" : ""}>
                {item.done ? "✓" : "○"} {item.label}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="content">
        {currentStep === 0 ? (
          <section className="card">
            <h1>Add your textbook content</h1>
            <p className="lead">
              Paste textbook text below. Keep headings like “Chapter 1” so we can split it
              automatically.
            </p>
            <textarea
              value={textbookText}
              onChange={(event) => setTextbookText(event.currentTarget.value)}
              placeholder="Paste textbook text here..."
            />
            <label>
              Max characters per chapter
              <input
                type="number"
                min={1000}
                max={40000}
                value={chapterMaxLength}
                onChange={(event) =>
                  setChapterMaxLength(Number(event.currentTarget.value))
                }
              />
            </label>
            <p className="hint">Detected chapters: {chapters.length}</p>
            <div className="actions">
              <button
                className="btn-primary"
                disabled={chapters.length === 0}
                onClick={() => setCurrentStep(1)}
              >
                Continue to chapter selection →
              </button>
            </div>
          </section>
        ) : null}

        {currentStep === 1 ? (
          <section className="card">
            <h1>Choose chapters</h1>
            <p className="lead">Each selected chapter becomes one podcast episode.</p>
            <div className="inline-actions">
              <button className="btn-secondary" onClick={selectAllChapters}>
                Select all
              </button>
              <button className="btn-secondary" onClick={clearChapterSelection}>
                Clear
              </button>
              <span className="hint">
                {selectedChapters.length} of {chapters.length} selected
              </span>
            </div>
            <ul className="chapter-list">
              {chapters.map((chapter) => {
                const selected = selectedChapterIndexes.includes(chapter.index);
                return (
                  <li key={`${chapter.index}-${chapter.title}`}>
                    <label className={`chapter-item ${selected ? "selected" : ""}`}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleChapter(chapter.index)}
                      />
                      <span>
                        <strong>{chapter.title}</strong>
                        <small>{chapter.content.length.toLocaleString()} chars</small>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="actions split">
              <button className="btn-secondary" onClick={() => setCurrentStep(0)}>
                ← Back
              </button>
              <button
                className="btn-primary"
                disabled={selectedChapters.length === 0}
                onClick={() => setCurrentStep(2)}
              >
                Continue to setup →
              </button>
            </div>
          </section>
        ) : null}

        {currentStep === 2 ? (
          <section className="card">
            <h1>Configure AI + voice setup</h1>
            <p className="lead">
              This is your one-time setup. Once paths are saved, generating episodes is a
              one-click workflow.
            </p>

            <div className="grid two">
              <label>
                LLM provider
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
                Model override
                <input
                  value={modelOverride}
                  onChange={(event) => setModelOverride(event.currentTarget.value)}
                  placeholder={selectedProvider.defaultModel}
                />
              </label>
              <label className="full">
                API key (optional for cloud LLM calls)
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.currentTarget.value)}
                  placeholder="sk-..."
                />
              </label>
            </div>
            <p className="hint">
              {selectedProvider.notes}{" "}
              <a href={selectedProvider.docsUrl} target="_blank" rel="noreferrer">
                provider docs
              </a>
            </p>

            <div className="grid three">
              <label>
                Kokoro model.onnx path
                <input
                  value={kokoroModelPath}
                  onChange={(event) => setKokoroModelPath(event.currentTarget.value)}
                  placeholder="/absolute/path/to/kokoro-v1.0.onnx"
                />
              </label>
              <label>
                Kokoro voices.bin path
                <input
                  value={kokoroVoicesPath}
                  onChange={(event) => setKokoroVoicesPath(event.currentTarget.value)}
                  placeholder="/absolute/path/to/voices-v1.0.bin"
                />
              </label>
              <label>
                Output directory
                <input
                  value={outputDirectory}
                  onChange={(event) => setOutputDirectory(event.currentTarget.value)}
                />
              </label>
              <label>
                Voice id
                <input value={voice} onChange={(event) => setVoice(event.currentTarget.value)} />
              </label>
              <label>
                Speed
                <input value={speed} onChange={(event) => setSpeed(event.currentTarget.value)} />
              </label>
            </div>

            <div className="actions split">
              <button className="btn-secondary" onClick={() => setCurrentStep(1)}>
                ← Back
              </button>
              <div className="inline-actions">
                <button className="btn-secondary" disabled={busy} onClick={runOrtCheck}>
                  Check ORT runtime
                </button>
                <button
                  className="btn-primary"
                  disabled={maxUnlockedStep < 3}
                  onClick={() => setCurrentStep(3)}
                >
                  Continue to generation →
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {currentStep === 3 ? (
          <section className="card">
            <h1>Generate scripts</h1>
            <p className="lead">
              Generate scripts for your selected chapters. If no API key is set, the app uses
              a built-in offline fallback script.
            </p>
            <div className="generate-panel">
              <p>
                Ready chapters: <strong>{selectedChapters.length}</strong>
              </p>
              <p>
                Provider: <strong>{selectedProvider.label}</strong>
              </p>
              <button className="btn-primary" disabled={busy} onClick={generateScripts}>
                {busy ? "Generating..." : "Generate chapter podcast scripts"}
              </button>
            </div>
            <div className="actions split">
              <button className="btn-secondary" onClick={() => setCurrentStep(2)}>
                ← Back
              </button>
              <button
                className="btn-secondary"
                disabled={scripts.length === 0}
                onClick={() => setCurrentStep(4)}
              >
                Go to episodes →
              </button>
            </div>
          </section>
        ) : null}

        {currentStep === 4 ? (
          <section className="card">
            <h1>Listen + synthesize audio</h1>
            <p className="lead">
              Scripts are ready. Click synthesize on any chapter to produce narration with
              Kokoro ONNX.
            </p>
            {scripts.length === 0 ? (
              <p className="hint">No scripts yet. Use the previous step to generate them first.</p>
            ) : (
              <ul className="script-list">
                {scripts.map((script) => (
                  <li key={`${script.chapter.index}-${script.chapter.title}`}>
                    <div className="script-head">
                      <h2>{script.chapter.title}</h2>
                      <button
                        className="btn-secondary"
                        disabled={
                          busy || !kokoroModelPath.trim() || !kokoroVoicesPath.trim()
                        }
                        onClick={() => synthesizeChapter(script)}
                      >
                        Synthesize audio
                      </button>
                    </div>
                    <p className="hint">Provider: {script.provider}</p>
                    <pre>{script.script}</pre>
                  </li>
                ))}
              </ul>
            )}
            <div className="actions">
              <button className="btn-secondary" onClick={() => setCurrentStep(3)}>
                ← Back to generation
              </button>
            </div>
          </section>
        ) : null}

        <p className="status">{statusMessage}</p>
      </main>
    </div>
  );
}

export default App;
