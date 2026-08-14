// Insert one sample session with a small checkpoint tree.
// Usage: node scripts/seed-sample.mjs
import { MongoClient, ObjectId } from "mongodb";
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
if (!uri) { console.error("MONGODB_URI is required."); process.exit(1); }
const dbName = process.env.MONGODB_DB || "convtree";

const client = new MongoClient(uri);
await client.connect();
try {
  const db = client.db(dbName);
  const now = new Date();

  const sessionId = new ObjectId();
  const rootId = new ObjectId();
  const childId = new ObjectId();

  // Root checkpoint (no parent, empty delta) + one child checkpoint with messages.
  await db.collection("nodes").insertMany([
    {
      _id: rootId,
      sessionId,
      shortId: "s1-0",
      parentId: null,
      depth: 0,
      label: "root",
      summary: "Session root",
      deltaMessages: [],
      createdAt: now,
    },
    {
      _id: childId,
      sessionId,
      shortId: "s1-1",
      parentId: rootId,
      depth: 1,
      label: "greeting",
      summary: "User says hello, assistant responds",
      deltaMessages: [
        { role: "user", content: "Hello, what is MongoDB Atlas?", createdAt: now },
        { role: "assistant", content: "Atlas is MongoDB's fully managed cloud database service.", createdAt: now },
      ],
      createdAt: now,
    },
  ]);

  await db.collection("sessions").insertOne({
    _id: sessionId,
    shortPrefix: "s1",
    counter: 1,
    rootNodeId: rootId,
    headCheckpointId: childId,
    title: "Sample: intro to Atlas",
    pendingMessages: [],
    createdAt: now,
  });

  console.log("Inserted session:", sessionId.toString());
  console.log("  checkpoints: 2 (root + 1 child)");
} finally {
  await client.close();
}
