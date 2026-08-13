# MongoDB Atlas setup

The application switches to Atlas automatically when `MONGODB_URI` is present
in the project-root `.env`. Without it, the application uses SQLite.

## 1. Connect the application

1. Open `Cluster0` in Atlas and click **Connect**.
2. Add your current IP address to the project IP access list.
3. Create a dedicated database user with read/write access to `second_wind`.
4. Choose **Drivers**, select **Python**, and copy the connection string.
5. Add the connection string and the variables from `.env.example` to `.env`.
6. Replace the username and password placeholders locally. Never commit `.env`.

Start the backend once. It creates the `conversations`, `nodes`, and
`attachments` collections plus the normal database indexes.

Verify the connection at `http://127.0.0.1:8000/database/status`. The response
must contain `"backend": "mongodb_atlas"` and `"connected": true`.

New conversations are written directly to Atlas. Existing SQLite conversations
remain local and are not copied automatically.

## 2. Create the Search index

1. Open **Search & Vector Search** for `Cluster0`.
2. Create a MongoDB Search index using the JSON editor.
3. Select database `second_wind` and collection `nodes`.
4. Name it `second_wind_search`.
5. Paste the contents of `atlas/search-index.json` and create the index.
6. Wait until its status is **Active**.

## 3. Create the semantic Vector Search index

Automated Embedding is a preview Atlas feature. If it is available in the
project:

1. In Atlas, create the Voyage AI model API keys requested for indexing and
   querying.
2. Open **Search & Vector Search** and create a Vector Search index.
3. Select database `second_wind` and collection `nodes`.
4. Name it `second_wind_vector`.
5. Paste the contents of `atlas/vector-index.json` and create the index.
6. Wait until the index is **Active** and existing node embeddings finish.

If Atlas does not offer Automated Embedding for the project, skip this index.
Core Atlas persistence and full-text search continue to work; the Second Wind
suggestion button reports that semantic suggestions are unavailable.
