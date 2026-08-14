import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { checkpoints, flatten, Message, pathToCheckpoint, sessions } from "@/lib/mongodb";
import { chatOnce, Provider } from "@/lib/llm";

/**
 * POST /api/chat
 * Body: { sessionId, prompt, provider, apiKey?, chatModel? }
 * Sends the prompt to the LLM using the full context: (committed messages
 * along the path from root to HEAD) + (session.pendingMessages). Appends both
 * the user prompt and the assistant reply to session.pendingMessages.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    sessionId: string;
    prompt: string;
    provider: Provider;
    apiKey?: string;
    chatModel?: string;
  };
  if (!body.sessionId || !body.prompt || !body.provider) {
    return NextResponse.json({ error: "sessionId, prompt, provider required" }, { status: 400 });
  }

  const sessionsC = await sessions();
  const cpsC = await checkpoints();
  const session = await sessionsC.findOne({ _id: new ObjectId(body.sessionId) });
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  const head = session.headCheckpointId.toHexString();
  const draft = session.drafts?.[head] ?? [];
  const path = await pathToCheckpoint(session.headCheckpointId);
  const committed = flatten(path);
  const messages = [
    ...committed.map((m) => ({ role: m.role, content: m.content })),
    ...draft.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: body.prompt },
  ];

  const answer = await chatOnce(messages, {
    provider: body.provider,
    apiKey: body.apiKey,
    chatModel: body.chatModel,
  });

  const now = new Date();
  const userMsg: Message = { role: "user", content: body.prompt, createdAt: now };
  const asstMsg: Message = { role: "assistant", content: answer, createdAt: now };
  await sessionsC.updateOne(
    { _id: session._id },
    { $push: { [`drafts.${head}`]: { $each: [userMsg, asstMsg] } } }
  );

  return NextResponse.json({ answer, userMsg, asstMsg });
}
