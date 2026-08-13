# Second Wind

Second Wind is an AI workspace for exploring multiple approaches without losing context. Start a conversation, branch from any earlier point, compare alternative paths, and merge the best ideas back together.

## What it has

- Streaming AI chat with selectable OpenAI models
- Multiple conversations with create, rename, delete, and automatic titles
- Interactive conversation graph
- Branching from any previous message
- Semantic three-way merge with common-ancestor and conflict detection
- Checkout and continue from any point in the conversation
- Full-text search across saved conversations
- File attachments for supported images, PDFs, text, and code files
- Local persistent storage with SQLite

## Run locally

### Requirements

- Python 3.10+
- Node.js 20+
- An OpenAI API key

### 1. Set up the backend

From the project root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=your_openai_api_key
```

Start the API:

```bash
source .venv/bin/activate
python -m uvicorn server.app:app --reload --host 127.0.0.1 --port 8000
```

### 2. Set up the frontend

In a second terminal:

```bash
cd web
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

## How to use it

1. Create a conversation and select a model.
2. Chat normally to build an initial path.
3. Click an earlier graph node to check it out and explore another approach.
4. Select two divergent nodes to merge their useful context.
5. Search or revisit saved conversations at any time.

## Stack

React, Vite, FastAPI, OpenAI, and SQLite. MongoDB Atlas integration is the next persistence layer for the hackathon build.
