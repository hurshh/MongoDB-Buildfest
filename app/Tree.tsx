"use client";
import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls, Edge, Node, Position, ReactFlowInstance } from "reactflow";
import "reactflow/dist/style.css";

export interface TreeNode {
  _id: string;
  shortId: string;
  parentId: string | null;
  depth: number;
  label: string;
  summary: string;
  messageCount: number;
}

interface Props {
  nodes: TreeNode[];
  headId: string | null;
  pathIds: Set<string>;
  onSelect: (id: string) => void;
}

function layout(nodes: TreeNode[]): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((n) => [n._id, n]));
  const children = new Map<string | null, TreeNode[]>();
  for (const n of nodes) {
    const arr = children.get(n.parentId) ?? [];
    arr.push(n);
    children.set(n.parentId, arr);
  }
  for (const arr of children.values()) arr.sort((a, b) => a.shortId.localeCompare(b.shortId, undefined, { numeric: true }));
  const positions = new Map<string, { x: number; y: number }>();
  const X_STEP = 190;
  const Y_STEP = 90;
  let cursor = 0;
  const walk = (id: string): number => {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) {
      const x = cursor * X_STEP;
      cursor += 1;
      positions.set(id, { x, y: (byId.get(id)!.depth) * Y_STEP });
      return x;
    }
    const xs = kids.map((k) => walk(k._id));
    const x = (xs[0] + xs[xs.length - 1]) / 2;
    positions.set(id, { x, y: (byId.get(id)!.depth) * Y_STEP });
    return x;
  };
  const roots = children.get(null) ?? [];
  for (const r of roots) walk(r._id);
  return positions;
}

export default function Tree({ nodes, headId, pathIds, onSelect }: Props) {
  const { rfNodes, rfEdges } = useMemo(() => {
    const positions = layout(nodes);
    const rfNodes: Node[] = nodes.map((n) => {
      const p = positions.get(n._id) ?? { x: 0, y: n.depth * 90 };
      const isHead = n._id === headId;
      const inPath = pathIds.has(n._id);
      const label = `${n.shortId}${isHead ? " ● HEAD" : ""}\n${truncate(n.label, 22)}`;
      return {
        id: n._id,
        position: p,
        data: { label },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        selected: isHead,
        style: {
          whiteSpace: "pre-wrap" as const,
          borderColor: isHead ? "var(--accent)" : inPath ? "var(--accent)" : "var(--border)",
          borderWidth: isHead ? 2 : 1,
        },
      };
    });
    const rfEdges: Edge[] = nodes
      .filter((n) => n.parentId)
      .map((n) => {
        const inPath = pathIds.has(n._id) && pathIds.has(n.parentId!);
        return {
          id: `${n.parentId}->${n._id}`,
          source: n.parentId!,
          target: n._id,
          className: inPath ? "path" : undefined,
          animated: inPath,
        };
      });
    return { rfNodes, rfEdges };
  }, [nodes, headId, pathIds]);

  // Re-fit the view whenever the SET of nodes changes (e.g. after a commit),
  // otherwise new nodes land outside the current viewport and the tree looks
  // like it vanished. Keyed on node ids so checkout/head changes don't jitter.
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);
  const idsKey = useMemo(() => nodes.map((n) => n._id).join(","), [nodes]);
  useEffect(() => {
    if (!rf) return;
    // Defer to the next frame so ReactFlow has applied and measured the new
    // nodes before we fit — otherwise it fits a half-built layout and the
    // branches look squished/overlapping.
    const t = setTimeout(() => rf.fitView({ duration: 200, padding: 0.25 }), 80);
    return () => clearTimeout(t);
  }, [rf, idsKey]);

  return (
    <div className="tree">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        fitView
        onInit={setRf}
        onNodeClick={(_, n) => onSelect(n.id)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
