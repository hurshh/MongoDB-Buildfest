# Second Wind

Second Wind is an AI workspace for exploring multiple approaches without losing context. Branch from any earlier message, investigate alternatives, and semantically merge the best ideas back together.

## Features

- Streaming chat with selectable OpenAI models
- Interactive conversation DAG with checkout and branching
- Semantic three-way merge with common-ancestor and conflict detection
- MongoDB Atlas persistence for conversations, nodes, branches, and merges
- MongoDB Search across saved messages and branch names
- MongoDB Vector Search for relevant ideas from parallel paths
- Multiple conversations with automatic titles, rename, and delete
- File attachments for images, PDFs, text, and code
- SQLite fallback when Atlas is not configured

## How Atlas is used

Second Wind stores each message as an individual document in the `nodes` collection. `parent_ids` and `children_ids` preserve the conversation graph, while merge metadata and structured state summaries live beside the message content.

The application uses three collections in the `second_wind` database:

- `conversations` — names, timestamps, and the active node
- `nodes` — messages, graph relationships, branches, summaries, and merges
- `attachments` — uploaded-file metadata

MongoDB Search powers full-text search. MongoDB Vector Search powers the **Second Wind** button, which retrieves relevant work from another branch and lets the user select it for a merge.

## Run locally

### Requirements

- Python 3.10+
- Node.js 20+
- OpenAI API key
- MongoDB Atlas cluster and database user

### 1. Install the backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and set the credentials:

```env
OPENAI_API_KEY=your_openai_api_key
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=second_wind
MONGODB_SEARCH_INDEX=second_wind_search
MONGODB_VECTOR_INDEX=second_wind_vector
MONGODB_EMBEDDING_MODEL=voyage-4
```

Never commit `.env`. URL-encode special characters in the database password.

Start the API:

```bash
source .venv/bin/activate
python -m uvicorn server.app:app --reload --host 127.0.0.1 --port 8000
```

Confirm Atlas is active:

```bash
curl http://127.0.0.1:8000/database/status
```

The response should contain `"backend":"mongodb_atlas"` and `"connected":true`. New conversations are then stored directly in Atlas; existing SQLite conversations are not copied automatically.

### 2. Install the frontend

In another terminal:

```bash
cd web
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

### 3. Create Atlas indexes

In Atlas, open **Search & Vector Search** for the cluster and use database `second_wind`, collection `nodes`:

1. Create `second_wind_search` using [`atlas/search-index.json`](atlas/search-index.json).
2. Create `second_wind_vector` using [`atlas/vector-index.json`](atlas/vector-index.json).
3. Wait until each index reports **Active**.

The vector definition uses Atlas Automated Embedding with Voyage AI. Persistence and normal chat work without the vector index, but semantic Second Wind suggestions require it. See [`atlas/README.md`](atlas/README.md) for the detailed console instructions.

## Use the app

1. Create a conversation and select a model.
2. Chat to build the initial path.
3. Click an earlier graph node and continue to create another path.
4. Select two divergent nodes and provide a merge prompt.
5. Enter a new prompt and click **Second Wind** to retrieve related ideas from other paths.

## Stack

React, Vite, FastAPI, OpenAI, MongoDB Atlas, MongoDB Search, and MongoDB Vector Search.
