# ConvTree — Git for LLM Conversations

Every user prompt spawns **3 distinct assistant options** as sibling nodes in a tree. Because nodes are append-only, every past state is a permanent checkpoint: click any node to continue from there, and the old subtree stays intact. When the tree grows dense, **semantic search** over all nodes lets you jump back to a state described in natural language.

Built on **MongoDB Atlas** — the tree is a document graph, `$graphLookup` rebuilds any root-to-node path in one query, and **Atlas Vector Search** powers node search. LLM provider is switchable: **Ollama** (local, no API key) or **OpenAI** (deployed public demos).

## Quick start

```bash
# 1. Fill in your Atlas connection string and (optionally) OpenAI key
cp .env.example .env
$EDITOR .env

# 2. Create collections + Atlas vector search index
npm run setup-atlas

# 3. For local demo — run Ollama (skip if using OpenAI in the UI)
ollama serve &
ollama pull llama3.2
ollama pull nomic-embed-text

# 4. Start the app
npm run dev
```

Open http://localhost:3000. Type a prompt at the root → three sibling nodes appear → click any to continue → branch again. Use the search box to jump to a node by meaning.

## How it works

- **Data model** (`lib/mongodb.ts`): `sessions` and `nodes` collections. Each node has `parentId`, `depth`, `userPrompt`, `assistantText`, and an `embedding` vector.
- **Path rebuild** (`pathToNode`): `$graphLookup` walks `parentId` from any node to the root; sort by `depth` → the exact conversation to feed the model for that branch.
- **N-option branching** (`lib/llm.ts` → `generateOptions`): one structured call asks the model for exactly N deliberately-distinct answers as JSON. Same cost as one completion, meaningful diversity because the model sees all N at once.
- **Semantic search** (`app/api/search/route.ts`): embeds the query and runs Atlas `$vectorSearch` filtered to the current session. Falls back to in-memory cosine if the index isn't READY yet.

## Provider dropdown

- **Ollama:** `provider=ollama` uses `http://localhost:11434`. Default models: `llama3.2` (chat) and `nomic-embed-text` (768-dim embeddings).
- **OpenAI:** `provider=openai` uses the API key you enter in the top bar (or `OPENAI_API_KEY` env). Default models: `gpt-4o-mini` (chat) and `text-embedding-3-small` (1536-dim).

Fix ONE embedder for the whole demo. The Atlas vector index has a single fixed dimension (`EMBED_DIM` in `.env`). Default is 768 (Ollama). If you plan to demo with OpenAI, set `EMBED_DIM=1536` before running `setup-atlas`.

## Deploy (public demo)

1. Push to GitHub (repo is already public).
2. Import to Vercel; set env vars: `MONGODB_URI`, `MONGODB_DB`, `OPENAI_API_KEY`, `EMBED_DIM` (match the index).
3. In Atlas, allow-list Vercel's egress IPs (or `0.0.0.0/0` for demo — tighten later).

## Sponsor swap-ins

The provider layer is a single interface (`generateOptions`, `embed`). To swap:

- **OpenRouter:** point `openai` client at `https://openrouter.ai/api/v1` and pass an OpenRouter key.
- **Voyage AI (MongoDB-owned):** replace `embed()` with the Voyage embeddings API; re-index if the dimension differs.
- **Fireworks:** OpenAI-compatible endpoint; swap the base URL.
- **ElevenLabs:** add a `POST /api/tts?nodeId=...` route that returns audio for the selected node's assistant text.
