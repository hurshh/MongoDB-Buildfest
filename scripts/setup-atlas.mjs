// One-shot script: create collections + Atlas Vector Search index on nodes.embedding.
// Usage: node scripts/setup-atlas.mjs
// Env: MONGODB_URI, MONGODB_DB, EMBED_DIM
import { MongoClient } from "mongodb";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// tiny .env loader (no deps)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is required. Copy .env.example to .env and fill it in.");
  process.exit(1);
}
const dbName = process.env.MONGODB_DB || "convtree";
const dim = Number(process.env.EMBED_DIM || 768);
if (!Number.isFinite(dim) || dim <= 0) {
  console.error(`EMBED_DIM invalid: ${process.env.EMBED_DIM}`);
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
try {
  const db = client.db(dbName);
  const existing = await db.listCollections({ name: { $in: ["sessions", "nodes"] } }).toArray();
  const have = new Set(existing.map((c) => c.name));
  if (!have.has("sessions")) {
    await db.createCollection("sessions");
    console.log("created collection: sessions");
  }
  if (!have.has("nodes")) {
    await db.createCollection("nodes");
    console.log("created collection: nodes");
  }
  await db.collection("nodes").createIndex({ sessionId: 1, depth: 1 });
  await db.collection("nodes").createIndex({ parentId: 1 });

  // Try Atlas Search index. Requires Atlas (not community server). Ignore
  // "already exists" and warn on other errors so local demos still work.
  const indexName = "node_vector_index";
  try {
    // @ts-ignore — createSearchIndex exists on Atlas
    await db.collection("nodes").createSearchIndex({
      name: indexName,
      type: "vectorSearch",
      definition: {
        fields: [
          {
            type: "vector",
            path: "embedding",
            numDimensions: dim,
            similarity: "cosine",
          },
          { type: "filter", path: "sessionId" },
        ],
      },
    });
    console.log(`Vector search index requested: ${indexName} (dim=${dim}). Atlas will build it in the background.`);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (/already exists/i.test(msg) || /duplicate/i.test(msg)) {
      console.log(`Vector search index ${indexName} already exists — ok.`);
    } else {
      console.warn(`Could not create vector search index: ${msg}`);
      console.warn("If you're on Atlas M0+ this may still be building. Semantic search will 404 gracefully until the index is READY.");
    }
  }
  console.log("Setup complete.");
} finally {
  await client.close();
}
