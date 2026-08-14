"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Tree, { TreeNode } from "./Tree";

type Provider = "ollama" | "openai" | "mock";

interface Message { role: "user" | "assistant"; content: string; createdAt?: string }
interface SearchResult {
  _id: string; shortId: string; parentId: string | null; depth: number;
  label: string; summary: string; score: number;
}
interface SessionMeta {
  sessionId: string; shortPrefix: string; title: string;
  headCheckpointId: string; nodeCount: number; createdAt: string;
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shortPrefix, setShortPrefix] = useState<string>("");
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [headId, setHeadId] = useState<string | null>(null);
  const [pathIds, setPathIds] = useState<Set<string>>(new Set());
  const [committed, setCommitted] = useState<Message[]>([]);
  const [pending, setPending] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>("mock");
  const [apiKey, setApiKey] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [embedModel, setEmbedModel] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [searched, setSearched] = useState(false);
  const [sessionList, setSessionList] = useState<SessionMeta[]>([]);
  const convRef = useRef<HTMLDivElement | null>(null);
  const bootedRef = useRef(false);

  const allMessages = useMemo(() => [...committed, ...pending], [committed, pending]);

  useEffect(() => {
    // auto-scroll conversation to bottom on new messages
    if (convRef.current) convRef.current.scrollTop = convRef.current.scrollHeight;
  }, [allMessages.length]);

  const refreshTree = useCallback(async (sid: string) => {
    const r = await fetch(`/api/tree?sessionId=${sid}`);
    const j = await r.json();
    if (r.ok) setTreeNodes(j.nodes);
  }, []);

  const refreshHeadPath = useCallback(async (sid: string, head: string) => {
    const r = await fetch(`/api/path?sessionId=${sid}&nodeId=${head}`);
    const j = await r.json();
    if (r.ok) {
      setCommitted(j.messages ?? []);
      setPending(j.pending ?? []);
      setPathIds(new Set((j.path as { _id: string }[]).map((p) => p._id)));
    }
  }, []);

  const loadSessions = useCallback(async (): Promise<SessionMeta[]> => {
    const r = await fetch("/api/sessions");
    const j = await r.json();
    if (r.ok) { setSessionList(j.sessions); return j.sessions as SessionMeta[]; }
    return [];
  }, []);

  const selectSession = useCallback(async (sid: string) => {
    setBusy(true); setStatus(null); setResults([]);
    try {
      const r = await fetch(`/api/session?sessionId=${sid}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "load failed");
      setSessionId(j.sessionId);
      setShortPrefix(j.shortPrefix);
      setHeadId(j.headCheckpointId);
      await refreshTree(j.sessionId);
      await refreshHeadPath(j.sessionId, j.headCheckpointId);
      setStatus(`opened ${j.shortPrefix}`);
    } catch (e) { setStatus(String(e)); } finally { setBusy(false); }
  }, [refreshTree, refreshHeadPath]);

  const startSession = useCallback(async () => {
    setBusy(true); setStatus(null); setResults([]);
    try {
      const r = await fetch("/api/session", { method: "POST", body: JSON.stringify({}) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "session failed");
      setSessionId(j.sessionId);
      setShortPrefix(j.shortPrefix);
      setHeadId(j.headCheckpointId);
      await refreshTree(j.sessionId);
      await refreshHeadPath(j.sessionId, j.headCheckpointId);
      await loadSessions();
      setStatus(`new session ${j.shortPrefix} — try chatting, then commit with /cp`);
    } catch (e) { setStatus(String(e)); } finally { setBusy(false); }
  }, [refreshTree, refreshHeadPath, loadSessions]);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    (async () => {
      const list = await loadSessions();
      if (list.length > 0) await selectSession(list[0].sessionId);
      else await startSession();
    })();
  }, [loadSessions, selectSession, startSession]);

  const sendChat = useCallback(async (prompt: string) => {
    if (!sessionId) return;
    setBusy(true); setStatus(null);
    // optimistic user echo
    setPending((p) => [...p, { role: "user", content: prompt }]);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId, prompt, provider,
          apiKey: apiKey || undefined,
          chatModel: chatModel || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "chat failed");
      // trust server for the final state
      await refreshHeadPath(sessionId, headId!);
    } catch (e) {
      setStatus(String(e));
      // roll back the optimistic echo
      setPending((p) => p.slice(0, -1));
    } finally { setBusy(false); }
  }, [sessionId, provider, apiKey, chatModel, headId, refreshHeadPath]);

  const doCheckpoint = useCallback(async (label?: string) => {
    if (!sessionId) return;
    if (pending.length === 0) { setStatus("nothing to commit — send a message first"); return; }
    setBusy(true); setStatus(null);
    try {
      const r = await fetch("/api/checkpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId, label, provider,
          apiKey: apiKey || undefined,
          embedModel: embedModel || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "commit failed");
      setStatus(`committed ${j.checkpoint.shortId} — "${j.checkpoint.label}"`);
      await refreshTree(sessionId);
      setHeadId(j.checkpoint._id);
      await refreshHeadPath(sessionId, j.checkpoint._id);
      await loadSessions();
    } catch (e) { setStatus(String(e)); } finally { setBusy(false); }
  }, [sessionId, pending.length, provider, apiKey, embedModel, refreshTree, refreshHeadPath, loadSessions]);

  const doCheckout = useCallback(async (nodeId: string) => {
    if (!sessionId) return;
    setBusy(true); setStatus(null);
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, nodeId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "checkout failed");
      setHeadId(j.headCheckpointId);
      await refreshHeadPath(sessionId, j.headCheckpointId);
      setStatus(`checked out ${j.shortId}`);
    } catch (e) { setStatus(String(e)); } finally { setBusy(false); }
  }, [sessionId, refreshHeadPath]);

  const submit = useCallback(async () => {
    const raw = input.trim();
    if (!raw) return;
    setInput("");
    if (raw === "/help") {
      setStatus("commands: /cp [label] — commit · /checkout <shortId> — switch HEAD · anything else — chat");
      return;
    }
    if (raw.startsWith("/cp") || raw.startsWith("/checkpoint")) {
      const label = raw.replace(/^\/cp\s*/, "").replace(/^\/checkpoint\s*/, "").trim();
      await doCheckpoint(label || undefined);
      return;
    }
    if (raw.startsWith("/checkout ")) {
      const shortId = raw.slice("/checkout ".length).trim();
      const target = treeNodes.find((n) => n.shortId === shortId);
      if (!target) { setStatus(`no node ${shortId}`); return; }
      await doCheckout(target._id);
      return;
    }
    await sendChat(raw);
  }, [input, doCheckpoint, doCheckout, sendChat, treeNodes]);

  const doSearch = useCallback(async () => {
    if (!sessionId || !query.trim()) return;
    setBusy(true); setStatus(null); setResults([]); setSearched(false);
    try {
      const r = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId, query, provider,
          apiKey: apiKey || undefined,
          embedModel: embedModel || undefined,
          k: 8,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "search failed");
      if (j.warning) setStatus(j.warning);
      setResults(j.results);
      setSearched(true);
    } catch (e) { setStatus(String(e)); } finally { setBusy(false); }
  }, [sessionId, query, provider, apiKey, embedModel]);

  return (
    <div className="app">
      <div className="topbar">
        <div className="title">ConvTree</div>
        <span className="muted">git for LLM conversations · /cp to commit · click a node to checkout</span>
        {shortPrefix && <span className="chip">session: {shortPrefix}</span>}
        {pending.length > 0 && <span className="chip" style={{ borderColor: "var(--assistant)", color: "var(--assistant)" }}>{pending.length} uncommitted</span>}
        <div style={{ flex: 1 }} />
        <label className="muted">open</label>
        <select value={sessionId ?? ""} onChange={(e) => selectSession(e.target.value)}
          title="Open a conversation tree" style={{ maxWidth: 260 }}>
          {sessionList.length === 0 && <option value="">(no sessions)</option>}
          {sessionList.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {s.shortPrefix} · {truncate(s.title, 28)} ({Math.max(0, s.nodeCount - 1)} commits)
            </option>
          ))}
        </select>
        <label className="muted">provider</label>
        <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
          <option value="mock">Mock (no key)</option>
          <option value="ollama">Ollama (local)</option>
          <option value="openai">OpenAI</option>
        </select>
        {provider === "openai" && (
          <input type="password" placeholder="OpenAI API key" value={apiKey}
            onChange={(e) => setApiKey(e.target.value)} style={{ width: 200 }} />
        )}
        <input placeholder={provider === "openai" ? "gpt-4o-mini" : "llama3.2"} value={chatModel}
          onChange={(e) => setChatModel(e.target.value)} style={{ width: 140 }} />
        <input placeholder={provider === "openai" ? "text-embedding-3-small" : "nomic-embed-text"} value={embedModel}
          onChange={(e) => setEmbedModel(e.target.value)} style={{ width: 180 }} />
        <button onClick={startSession} disabled={busy}>New session</button>
      </div>

      <div className="main">
        <div className="left">
          <div className="section-h section-h-row">
            <span>Commit tree · click a node to checkout</span>
            <button className="toggle" onClick={() => {
                setShowSearch((v) => {
                  const next = !v;
                  if (!next) { setResults([]); setQuery(""); setSearched(false); } // clear on close
                  return next;
                });
              }}
              title="Semantic search over checkpoints">
              {showSearch ? "✕ close search" : "🔍 search"}
            </button>
          </div>
          <Tree nodes={treeNodes} headId={headId} pathIds={pathIds} onSelect={doCheckout} />
          {showSearch && (
            <>
              <div className="search">
                <input autoFocus
                  placeholder="Semantic search over checkpoints (e.g. 'where did we discuss pricing')"
                  value={query} onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doSearch();
                    if (e.key === "Escape") { setShowSearch(false); setResults([]); setQuery(""); setSearched(false); }
                  }} />
                <button onClick={doSearch} disabled={busy || !query.trim()}>Search</button>
              </div>
              {results.length > 0 && (
                <div className="search-results">
                  {results.map((r) => (
                    <div key={r._id} className="result" onClick={() => doCheckout(r._id)}>
                      <div><strong>{r.shortId}</strong> — {r.label} <span className="meta">score {r.score.toFixed(3)}</span></div>
                      <div className="meta">{truncate(r.summary, 200)}</div>
                    </div>
                  ))}
                </div>
              )}
              {searched && results.length === 0 && !busy && (
                <div className="search-results">
                  <div className="meta" style={{ padding: "6px 4px" }}>no matching checkpoints</div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="right">
          <div className="section-h">
            Conversation · HEAD = {headShort(treeNodes, headId)}
            {pending.length > 0 && <span style={{ color: "var(--assistant)", marginLeft: 8 }}>· {pending.length} uncommitted</span>}
          </div>
          <div className="conv" ref={convRef}>
            {allMessages.length === 0 && (
              <div className="msg assistant"><div className="who">assistant</div>
                Start chatting. Type <code>/cp label</code> to checkpoint (commit) — that adds a node to the tree.
                Click any node in the tree to check it out and continue from there.
              </div>
            )}
            {allMessages.map((m, i) => {
              const isPending = i >= committed.length;
              return (
                <div key={i} className={`msg ${m.role}`}>
                  <div className="who">{m.role}{isPending && <span className="shortId">uncommitted</span>}</div>
                  {m.content}
                </div>
              );
            })}
          </div>
          <div className="compose">
            <textarea
              placeholder="chat · /cp [label] to commit · /checkout <shortId> to switch · /help"
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
              }} />
            <button onClick={submit} disabled={busy || !input.trim()}>
              {busy ? "…" : "Send"}
            </button>
            <button onClick={() => doCheckpoint()} disabled={busy || pending.length === 0}
              title="Same as /cp">
              /cp
            </button>
          </div>
          {status && <div className="footer">{status}</div>}
        </div>
      </div>
    </div>
  );
}

function headShort(nodes: TreeNode[], id: string | null): string {
  if (!id) return "—";
  const n = nodes.find((x) => x._id === id);
  return n ? `${n.shortId} · ${n.label}` : "—";
}
function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
