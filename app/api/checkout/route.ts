import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { checkpoints, sessions } from "@/lib/mongodb";

/**
 * POST /api/checkout
 * Body: { sessionId, nodeId }
 * Moves HEAD to nodeId. Drafts are per-node, so uncommitted messages on the
 * node you're leaving are preserved (not discarded) and the node you land on
 * shows its own draft, if any. Switching is always lossless.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { sessionId: string; nodeId: string };
  if (!body.sessionId || !body.nodeId) {
    return NextResponse.json({ error: "sessionId and nodeId required" }, { status: 400 });
  }
  const sessionsC = await sessions();
  const cpsC = await checkpoints();
  const s = await sessionsC.findOne({ _id: new ObjectId(body.sessionId) });
  if (!s) return NextResponse.json({ error: "session not found" }, { status: 404 });
  const target = await cpsC.findOne({ _id: new ObjectId(body.nodeId) });
  if (!target || !target.sessionId.equals(s._id)) {
    return NextResponse.json({ error: "target node not in this session" }, { status: 404 });
  }
  await sessionsC.updateOne(
    { _id: s._id },
    { $set: { headCheckpointId: target._id } }
  );
  return NextResponse.json({
    headCheckpointId: target._id.toHexString(),
    shortId: target.shortId,
  });
}
