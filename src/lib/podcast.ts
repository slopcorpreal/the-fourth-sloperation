export type LlmProvider = {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  docsUrl: string;
  notes: string;
};

export type ChapterSegment = {
  index: number;
  title: string;
  content: string;
};

export type ChapterScript = {
  chapter: ChapterSegment;
  script: string;
  provider: string;
};

export const FREE_LLM_PROVIDERS: LlmProvider[] = [
  {
    id: "openrouter",
    label: "OpenRouter (free models)",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    docsUrl: "https://openrouter.ai/models?max_price=0",
    notes: "Free models rotate. Bring your own OpenRouter API key.",
  },
  {
    id: "groq",
    label: "Groq free tier",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "llama-3.3-70b-versatile",
    docsUrl: "https://console.groq.com/docs/quickstart",
    notes: "Fast responses with free tier limits.",
  },
  {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    baseUrl:
      "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1/chat/completions",
    defaultModel: "@cf/meta/llama-3.1-8b-instruct",
    docsUrl: "https://developers.cloudflare.com/workers-ai/",
    notes: "Requires account ID and token. Free quota available.",
  },
];

const chapterHeadingPattern = /^(chapter|unit|part)\s+[\w\divxlc\-\.: ]+/i;

export function splitTextbookIntoChapters(
  textbookText: string,
  maxChapterLength = 12000,
): ChapterSegment[] {
  const lines = textbookText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line: string) => line.trimEnd());

  const chapterChunks: { title: string; content: string[] }[] = [];
  let currentTitle = "Introduction";
  let currentContent: string[] = [];

  for (const line of lines) {
    if (chapterHeadingPattern.test(line.trim())) {
      if (currentContent.join("\n").trim()) {
        chapterChunks.push({ title: currentTitle, content: currentContent });
      }
      currentTitle = line.trim();
      currentContent = [];
      continue;
    }

    currentContent.push(line);
  }

  if (currentContent.join("\n").trim()) {
    chapterChunks.push({ title: currentTitle, content: currentContent });
  }

  if (!chapterChunks.length) {
    return splitByLengthFallback(textbookText, maxChapterLength);
  }

  return chapterChunks.flatMap((chunk, chunkIndex) => {
    const normalized = chunk.content.join("\n").trim();
    if (normalized.length <= maxChapterLength) {
      return [
        {
          index: chunkIndex,
          title: chunk.title,
          content: normalized,
        },
      ];
    }
    return splitByLengthFallback(normalized, maxChapterLength, chunk.title);
  });
}

function splitByLengthFallback(
  text: string,
  maxLength: number,
  titlePrefix = "Section",
): ChapterSegment[] {
  const sanitized = text.trim();
  if (!sanitized) {
    return [];
  }

  const chunks: ChapterSegment[] = [];
  let cursor = 0;
  let chunkIndex = 0;
  while (cursor < sanitized.length) {
    const upperBound = Math.min(cursor + maxLength, sanitized.length);
    let splitAt = sanitized.lastIndexOf("\n", upperBound);
    if (splitAt <= cursor) {
      splitAt = upperBound;
    }

    chunks.push({
      index: chunkIndex,
      title: `${titlePrefix} ${chunkIndex + 1}`,
      content: sanitized.slice(cursor, splitAt).trim(),
    });
    cursor = splitAt;
    chunkIndex += 1;
  }

  return chunks.filter((chunk) => chunk.content.length > 0);
}

export async function generateChapterScriptWithProvider(
  chapter: ChapterSegment,
  provider: LlmProvider,
  apiKey: string,
  model: string,
): Promise<ChapterScript> {
  const response = await fetch(provider.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You are a podcast writer. Convert textbook material into clear, engaging spoken narration with examples and smooth transitions.",
        },
        {
          role: "user",
          content: buildChapterPrompt(chapter),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Provider request failed (${response.status}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const script = payload.choices?.[0]?.message?.content?.trim();
  if (!script) {
    throw new Error("Provider returned no usable script content.");
  }

  return {
    chapter,
    provider: provider.label,
    script,
  };
}

export function buildOfflineFallbackScript(chapter: ChapterSegment): ChapterScript {
  const paragraphs = chapter.content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 8);

  const bulletPoints = paragraphs
    .map((paragraph, index) => `Point ${index + 1}: ${paragraph}`)
    .join("\n");

  return {
    chapter,
    provider: "Offline fallback",
    script: `Welcome to ${chapter.title}. In this episode, we walk through the core ideas from this chapter.\n\n${bulletPoints}\n\nThat wraps up ${chapter.title}. In the next chapter, we'll build on these concepts.`,
  };
}

function buildChapterPrompt(chapter: ChapterSegment): string {
  return `Create a podcast episode script for the chapter "${chapter.title}". Keep it educational but conversational.

Requirements:
- 5 to 8 minute spoken script length.
- Explain key concepts progressively.
- Include 2 practical examples.
- End with a recap and teaser for the next chapter.

Chapter content:
${chapter.content}`;
}
