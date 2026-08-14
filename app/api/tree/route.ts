import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { checkpoints } from "@/lib/mongodb";

/**
 * GET /api/tree?sessionId=...
 * Returns all checkpoints (tree nodes) for the session.
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  const c = await checkpoints();
  const docs = await c
    .find({ sessionId: new ObjectId(sessionId) })
    .sort({ depth: 1, createdAt: 1 })
    .toArray();
  return NextResponse.json({
    nodes: docs.map((d) => ({
      _id: d._id.toHexString(),
      shortId: d.shortId,
      parentId: d.parentId?.toHexString() ?? null,
      depth: d.depth,
      label: d.label,
      summary: d.summary,
      messageCount: d.deltaMessages?.length ?? 0,
    })),
  });
}
