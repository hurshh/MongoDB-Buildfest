import OpenAI from "openai";

export type Provider = "ollama" | "openai" | "mock";

export interface ProviderConfig {
  provider: Provider;
  chatModel?: string;
  embedModel?: string;
  apiKey?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Single chat completion. Returns the assistant's plain-text answer. */
export async function chatOnce(messages: ChatMessage[], cfg: ProviderConfig): Promise<string> {
  if (cfg.provider === "mock") return mockChat(messages);
  if (cfg.provider === "openai") {
    const key = cfg.apiKey || process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OpenAI API key missing");
    const client = new OpenAI({ apiKey: key });
    const resp = await client.chat.completions.create({
      model: cfg.chatModel || process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0.7,
    });
    return resp.choices[0]?.message?.content ?? "";
  }
  const base = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = cfg.chatModel || process.env.OLLAMA_CHAT_MODEL || "llama3.2";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0.7 } }),
  });
  if (!res.ok) throw new Error(`Ollama chat failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}

/** Embed text for Atlas Vector Search. */
export async function embed(text: string, cfg: ProviderConfig): Promise<number[]> {
  if (cfg.provider === "mock") return mockEmbed(text);
  if (cfg.provider === "openai") {
    const key = cfg.apiKey || process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OpenAI API key missing");
    const client = new OpenAI({ apiKey: key });
    const model = cfg.embedModel || process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
    const r = await client.embeddings.create({ model, input: text });
    return r.data[0].embedding as unknown as number[];
  }
  const base = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = cfg.embedModel || process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
  const res = await fetch(`${base}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
  });
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { embedding: number[] };
  return data.embedding;
}

// ---------------------------------------------------------------------------
// Mock provider — no API key, no Ollama. Lets the whole app run offline for a
// demo. Chat produces a plausible reply; embeddings are a real bag-of-words
// hashing vectorizer so semantic search returns lexically-relevant nodes.
// ---------------------------------------------------------------------------
const MOCK_DIM = 1024;

function mockChat(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const priorUser = messages.filter((m) => m.role === "user").length;
  const topic = keywords(lastUser).slice(0, 3).join(", ") || "this";
  const lines = [
    `There are a few angles worth weighing on ${topic}, and the right choice really depends on your constraints and what you're optimizing for.`,
    priorUser > 1
      ? `Building on what we covered earlier, I'd lean toward the option that keeps you flexible while you learn more.`
      : `A good starting point is to get clear on the single most important outcome you want here.`,
    `Want me to go deeper on any one of these, or lay out the trade-offs side by side?`,
  ];
  return lines.join("\n\n");
}

function mockEmbed(text: string): number[] {
  const v = new Array(MOCK_DIM).fill(0);
  for (const tok of keywords(text)) {
    // hash the full token AND a 4-char stem, so "price"/"pricing" overlap.
    v[hash(tok) % MOCK_DIM] += 1;
    if (tok.length > 4) v[hash(tok.slice(0, 4)) % MOCK_DIM] += 0.6;
  }
  // L2 normalize
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}
const STOP = new Set([
  "the", "and", "for", "are", "but", "not", "you", "with", "this", "that",
  "have", "from", "your", "what", "how", "why", "can", "will", "would",
  "about", "into", "them", "they", "our", "out", "was", "were", "has",
]);
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
