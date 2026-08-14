import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { flatten, pathToCheckpoint, sessions } from "@/lib/mongodb";

/**
 * GET /api/path?sessionId=...&nodeId=...
 * Returns the ordered root -> node path and the flattened conversation.
 * If sessionId is provided AND nodeId equals current HEAD, appends the
 * session's pending (uncommitted) messages so the client can render them
 * inline as "working directory" content.
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const nodeId = req.nextUrl.searchParams.get("nodeId");
  if (!nodeId) return NextResponse.json({ error: "nodeId required" }, { status: 400 });

  const path = await pathToCheckpoint(new ObjectId(nodeId));
  const messages = flatten(path);

  let pending: typeof messages = [];
  let isHead = false;
  if (sessionId) {
    const s = await sessions();
    const doc = await s.findOne({ _id: new ObjectId(sessionId) });
    if (doc) {
      isHead = doc.headCheckpointId.equals(new ObjectId(nodeId));
      // per-node draft: show whatever uncommitted messages hang off this node
      pending = doc.drafts?.[nodeId] ?? [];
    }
  }

  return NextResponse.json({
    path: path.map((d) => ({
      _id: d._id.toHexString(),
      shortId: d.shortId,
      parentId: d.parentId?.toHexString() ?? null,
      depth: d.depth,
      label: d.label,
      summary: d.summary,
      messageCount: d.deltaMessages?.length ?? 0,
    })),
    messages,
    pending,
    isHead,
  });
}
