import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { checkpoints } from "@/lib/mongodb";
import { embed, Provider } from "@/lib/llm";

/**
 * POST /api/search
 * Body: { sessionId, query, provider, apiKey?, embedModel?, k? }
 * Vector-search checkpoints in this session by meaning. Falls back to
 * in-memory cosine if the Atlas index isn't ready yet.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    sessionId: string;
    query: string;
    provider: Provider;
    apiKey?: string;
    embedModel?: string;
    k?: number;
  };
  if (!body.sessionId || !body.query) {
    return NextResponse.json({ error: "sessionId and query required" }, { status: 400 });
  }
  const k = Math.min(20, Math.max(1, body.k ?? 5));

  const queryVec = await embed(body.query, {
    provider: body.provider,
    apiKey: body.apiKey,
    embedModel: body.embedModel,
  });

  const c = await checkpoints();
  try {
    const results = await c
      .aggregate([
        {
          $vectorSearch: {
            index: "node_vector_index",
            path: "embedding",
            queryVector: queryVec,
            numCandidates: 100,
            limit: k,
            filter: { sessionId: new ObjectId(body.sessionId) },
          },
        },
        {
          $project: {
            shortId: 1, parentId: 1, depth: 1, label: 1, summary: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ])
      .toArray();
    return NextResponse.json({
      results: results.map((r) => ({
        _id: r._id.toHexString(),
        shortId: r.shortId,
        parentId: r.parentId?.toHexString() ?? null,
        depth: r.depth,
        label: r.label,
        summary: r.summary,
        score: r.score,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const all = await c
      .find({ sessionId: new ObjectId(body.sessionId), embedding: { $exists: true } })
      .toArray();
    const scored = all
      .map((n) => ({ node: n, score: cosine(queryVec, n.embedding as number[]) }))
      .filter((x) => x.score > 0.1) // drop irrelevant / weak-collision matches
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    return NextResponse.json({
      warning: `vector index unavailable, using in-memory fallback: ${msg}`,
      results: scored.map(({ node, score }) => ({
        _id: node._id.toHexString(),
        shortId: node.shortId,
        parentId: node.parentId?.toHexString() ?? null,
        depth: node.depth,
        label: node.label,
        summary: node.summary,
        score,
      })),
    });
  }
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
