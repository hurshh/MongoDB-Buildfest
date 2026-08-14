import { MongoClient, Db, Collection, ObjectId } from "mongodb";

let cached: { client: MongoClient; db: Db } | null = null;

export async function getDb(): Promise<Db> {
  if (cached) return cached.db;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "convtree");
  cached = { client, db };
  return db;
}

/** A single chat message (user or assistant) inside a checkpoint's delta. */
export interface Message {
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

export interface SessionDoc {
  _id: ObjectId;
  shortPrefix: string;              // e.g. "s1"
  counter: number;                  // monotonic per-session id counter
  rootNodeId: ObjectId;
  headCheckpointId: ObjectId;       // current HEAD; new chat + /cp branches from here
  title: string;
  // Uncommitted messages, keyed by the checkpoint they hang off of (hex _id).
  // This makes drafts per-node, so switching nodes never loses in-progress work.
  drafts: Record<string, Message[]>;
  createdAt: Date;
}

/** A checkpoint is a commit: an immutable tree node storing the delta from
 *  its parent (i.e. the messages between the parent checkpoint and this one). */
export interface CheckpointDoc {
  _id: ObjectId;
  sessionId: ObjectId;
  shortId: string;                  // e.g. "s1-3"
  parentId: ObjectId | null;        // null for root
  depth: number;
  label: string;                    // "/cp <label>" or auto
  summary: string;                  // short human-readable summary
  deltaMessages: Message[];         // messages since parent checkpoint (empty for root)
  embedding?: number[];             // vector for semantic search
  createdAt: Date;
}

export const COLL_SESSIONS = "sessions";
export const COLL_NODES = "nodes";  // keep name for existing index compatibility

export async function sessions(): Promise<Collection<SessionDoc>> {
  return (await getDb()).collection<SessionDoc>(COLL_SESSIONS);
}
export async function checkpoints(): Promise<Collection<CheckpointDoc>> {
  return (await getDb()).collection<CheckpointDoc>(COLL_NODES);
}

/** Reconstruct path root -> checkpoint (in order) using $graphLookup. */
export async function pathToCheckpoint(nodeId: ObjectId): Promise<CheckpointDoc[]> {
  const c = await checkpoints();
  const result = await c
    .aggregate<CheckpointDoc & { _ancestors: CheckpointDoc[] }>([
      { $match: { _id: nodeId } },
      {
        $graphLookup: {
          from: COLL_NODES,
          startWith: "$parentId",
          connectFromField: "parentId",
          connectToField: "_id",
          as: "_ancestors",
        },
      },
    ])
    .toArray();
  if (!result[0]) return [];
  const doc = result[0];
  const ordered = [...doc._ancestors, { ...doc, _ancestors: undefined } as CheckpointDoc]
    .sort((a, b) => a.depth - b.depth);
  return ordered.map((n) => {
    const { _ancestors, ...rest } = n as CheckpointDoc & { _ancestors?: CheckpointDoc[] };
    return rest as CheckpointDoc;
  });
}

/** Flatten root-to-checkpoint deltas into a plain message list. */
export function flatten(path: CheckpointDoc[]): Message[] {
  const out: Message[] = [];
  for (const cp of path) out.push(...(cp.deltaMessages || []));
  return out;
}
