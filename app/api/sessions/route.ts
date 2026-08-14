import { NextResponse } from "next/server";
import { checkpoints, sessions } from "@/lib/mongodb";

/**
 * GET /api/sessions
 * Lists all sessions (conversation trees), most recent first, with node counts.
 */
export async function GET() {
  const sessionsC = await sessions();
  const cpsC = await checkpoints();
  const docs = await sessionsC.find({}).sort({ createdAt: -1 }).toArray();
  const counts = await cpsC
    .aggregate<{ _id: unknown; n: number }>([{ $group: { _id: "$sessionId", n: { $sum: 1 } } }])
    .toArray();
  const countMap = new Map(counts.map((c) => [String(c._id), c.n]));
  return NextResponse.json({
    sessions: docs.map((s) => ({
      sessionId: s._id.toHexString(),
      shortPrefix: s.shortPrefix,
      title: s.title,
      headCheckpointId: s.headCheckpointId.toHexString(),
      nodeCount: countMap.get(s._id.toHexString()) ?? 0,
      createdAt: s.createdAt,
    })),
  });
}
