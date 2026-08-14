import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { checkpoints, sessions } from "@/lib/mongodb";
import { embed, Provider } from "@/lib/llm";

/**
 * POST /api/checkpoint
 * Body: { sessionId, label?, provider, apiKey?, embedModel? }
 * Commit: takes session.pendingMessages, writes them as a new checkpoint
 * (child of current HEAD), embeds a summary, moves HEAD, clears pending.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    sessionId: string;
    label?: string;
    provider: Provider;
    apiKey?: string;
    embedModel?: string;
  };
  if (!body.sessionId || !body.provider) {
    return NextResponse.json({ error: "sessionId and provider required" }, { status: 400 });
  }

  const sessionsC = await sessions();
  const cpsC = await checkpoints();
  const session = await sessionsC.findOne({ _id: new ObjectId(body.sessionId) });
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  const head = session.headCheckpointId.toHexString();
  const draft = session.drafts?.[head] ?? [];
  if (draft.length === 0) {
    return NextResponse.json({ error: "nothing to commit — send a message first" }, { status: 400 });
  }
  const parent = await cpsC.findOne({ _id: session.headCheckpointId });
  if (!parent) return NextResponse.json({ error: "head checkpoint missing" }, { status: 500 });

  // reserve a short id via $inc on counter
  const upd = await sessionsC.findOneAndUpdate(
    { _id: session._id },
    { $inc: { counter: 1 } },
    { returnDocument: "after" }
  );
  if (!upd) return NextResponse.json({ error: "session vanished" }, { status: 500 });

  const label =
    (body.label && body.label.trim()) ||
    truncate(draft.find((m) => m.role === "user")?.content || "checkpoint", 40);
  const summary = summarize(draft, label);

  // Embed the topic-bearing text — the label + the user's questions — rather
  // than the full summary, so shared assistant boilerplate doesn't dilute the
  // vector and make unrelated checkpoints look similar.
  const embedText = [label, ...draft.filter((m) => m.role === "user").map((m) => m.content)].join(" \n ");
  let embedding: number[] | undefined;
  try {
    embedding = await embed(embedText, {
      provider: body.provider,
      apiKey: body.apiKey,
      embedModel: body.embedModel,
    });
  } catch {
    embedding = undefined;
  }

  const now = new Date();
  const newCp = {
    _id: new ObjectId(),
    sessionId: session._id,
    shortId: `${upd.shortPrefix}-${upd.counter}`,
    parentId: parent._id,
    depth: parent.depth + 1,
    label,
    summary,
    deltaMessages: draft,
    embedding,
    createdAt: now,
  };
  await cpsC.insertOne(newCp);

  // Auto-name the session from its first user message so it's recognizable
  // in the session picker.
  const firstUser = draft.find((m) => m.role === "user")?.content || "";
  const setFields: Record<string, unknown> = { headCheckpointId: newCp._id };
  if (session.title === "Untitled session" && firstUser) {
    setFields.title = truncate(firstUser, 50);
  }

  // Move HEAD to the new checkpoint and clear this node's draft (its messages
  // are now committed). Other nodes' drafts are untouched.
  await sessionsC.updateOne(
    { _id: session._id },
    { $set: setFields, $unset: { [`drafts.${head}`]: "" } }
  );

  return NextResponse.json({
    checkpoint: {
      _id: newCp._id.toHexString(),
      shortId: newCp.shortId,
      parentId: newCp.parentId?.toHexString() ?? null,
      depth: newCp.depth,
      label: newCp.label,
      summary: newCp.summary,
      messageCount: newCp.deltaMessages.length,
    },
  });
}

function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function summarize(msgs: { role: string; content: string }[], label: string) {
  const firstUser = msgs.find((m) => m.role === "user")?.content ?? "";
  const lastAsst = [...msgs].reverse().find((m) => m.role === "assistant")?.content ?? "";
  return `${label}\nQ: ${truncate(firstUser, 200)}\nA: ${truncate(lastAsst, 300)}`;
}
