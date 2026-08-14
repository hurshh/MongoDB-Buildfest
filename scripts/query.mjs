// Demonstrates common ways to query the data.
// Usage: node scripts/query.mjs
import { MongoClient } from "mongodb";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
try {
  const db = client.db(process.env.MONGODB_DB || "convtree");

  // 1. Count documents
  console.log("=== Counts ===");
  console.log("sessions:", await db.collection("sessions").countDocuments());
  console.log("nodes:", await db.collection("nodes").countDocuments());

  // 2. Find all sessions (project only a few fields)
  console.log("\n=== Sessions ===");
  const sess = await db.collection("sessions")
    .find({}, { projection: { title: 1, shortPrefix: 1, createdAt: 1 } })
    .toArray();
  for (const s of sess) console.log(`  ${s.shortPrefix}  "${s.title}"  (${s._id})`);

  // 3. Filter: checkpoints at depth >= 1 that have messages
  console.log("\n=== Checkpoints with messages (depth >= 1) ===");
  const cps = await db.collection("nodes")
    .find({ depth: { $gte: 1 }, "deltaMessages.0": { $exists: true } })
    .toArray();
  for (const c of cps) {
    console.log(`  ${c.shortId} "${c.label}" — ${c.deltaMessages.length} msg(s)`);
    for (const m of c.deltaMessages) console.log(`      [${m.role}] ${m.content}`);
  }

  // 4. Tree walk: reconstruct root -> leaf path with $graphLookup
  console.log("\n=== Path reconstruction ($graphLookup) ===");
  const leaf = await db.collection("nodes").findOne({ depth: { $gte: 1 } });
  if (leaf) {
    const [res] = await db.collection("nodes").aggregate([
      { $match: { _id: leaf._id } },
      { $graphLookup: {
          from: "nodes",
          startWith: "$parentId",
          connectFromField: "parentId",
          connectToField: "_id",
          as: "ancestors",
      } },
    ]).toArray();
    const path = [...res.ancestors, res].sort((a, b) => a.depth - b.depth);
    console.log("  " + path.map((n) => n.shortId).join(" -> "));
  }
} finally {
  await client.close();
}
