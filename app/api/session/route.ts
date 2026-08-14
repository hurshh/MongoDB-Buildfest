import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { checkpoints, sessions } from "@/lib/mongodb";

/**
 * POST /api/session
 * Body: { title?: string }
 * Creates a new session with a root checkpoint. HEAD = root; no pending messages.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const sessionsC = await sessions();
  const cpsC = await checkpoints();

  const count = await sessionsC.countDocuments({});
  const shortPrefix = `s${count + 1}`;
  const sessionId = new ObjectId();
  const rootId = new ObjectId();
  const now = new Date();

  await cpsC.insertOne({
    _id: rootId,
    sessionId,
    shortId: `${shortPrefix}-0`,
    parentId: null,
    depth: 0,
    label: "root",
    summary: "(start of conversation)",
    deltaMessages: [],
    createdAt: now,
  });
  await sessionsC.insertOne({
    _id: sessionId,
    shortPrefix,
    counter: 0,
    rootNodeId: rootId,
    headCheckpointId: rootId,
    title: body.title || "Untitled session",
    drafts: {},
    createdAt: now,
  });

  return NextResponse.json({
    sessionId: sessionId.toHexString(),
    rootNodeId: rootId.toHexString(),
    headCheckpointId: rootId.toHexString(),
    shortId: `${shortPrefix}-0`,
    shortPrefix,
  });
}

/**
 * GET /api/session?sessionId=...
 * Returns session state: HEAD, pending messages, prefix.
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  const sessionsC = await sessions();
  const s = await sessionsC.findOne({ _id: new ObjectId(sessionId) });
  if (!s) return NextResponse.json({ error: "session not found" }, { status: 404 });
  const head = s.headCheckpointId.toHexString();
  return NextResponse.json({
    sessionId: s._id.toHexString(),
    shortPrefix: s.shortPrefix,
    headCheckpointId: head,
    pendingMessages: s.drafts?.[head] ?? [],
    title: s.title,
  });
}
