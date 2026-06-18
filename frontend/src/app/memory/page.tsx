"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Sidebar from "@/components/Sidebar";
import MemoryGraphCanvas from "@/components/MemoryGraphCanvas";
import { api, Chat } from "@/lib/api";
import {
  Database,
  Search,
  Trash2,
  Bookmark,
  Network,
  RefreshCw,
  Info,
  Loader2,
  ChevronDown,
  ArrowLeft,
  Share2,
  Zap
} from "lucide-react";

interface Node {
  id: string;
  label: string;
  type: string;
  desc: string;
}

interface Edge {
  source: string;
  target: string;
  label: string;
}

export default function MemoryExplorerPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  
  // Real Neo4j / SQLite Graph Data States
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [keyFacts, setKeyFacts] = useState<string[]>([]);
  
  // Active Interactive Selection
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Load chat sessions on mount
  useEffect(() => {
    const loadChats = async () => {
      try {
        const chatList = await api.getChats();
        setChats(chatList);
        if (chatList.length > 0) {
          setSelectedChatId(chatList[0].id);
        }
      } catch (err) {
        console.error("Failed to load chats:", err);
      }
    };
    loadChats();
  }, []);

  // Fetch graph when session changes
  const fetchGraph = useCallback(async () => {
    if (!selectedChatId) {
      setNodes([]);
      setEdges([]);
      setKeyFacts([]);
      return;
    }
    setLoading(true);
    setSelectedNodeId(null); // Clear active selections
    try {
      const data = await api.getSessionGraph(selectedChatId);
      const entities = data.entities || [];
      const relationships = data.relationships || [];
      const facts = data.key_facts || [];

      // Construct graph structures matching Neo4j data
      const graphNodes: Node[] = entities.map((ent: any, idx: number) => ({
        id: `node-${idx}`,
        label: ent.name,
        type: (ent.type || "concept").toLowerCase(),
        desc: ent.description || "No description provided."
      }));

      const graphEdges: Edge[] = relationships
        .map((rel: any) => {
          const srcNode = graphNodes.find((n) => n.label === rel.source);
          const tgtNode = graphNodes.find((n) => n.label === rel.target);
          return {
            source: srcNode?.id || "",
            target: tgtNode?.id || "",
            label: rel.type || "RELATED_TO"
          };
        })
        .filter((e: Edge) => e.source && e.target);

      setNodes(graphNodes);
      setEdges(graphEdges);
      setKeyFacts(facts);
    } catch (err) {
      console.error("Failed to fetch session graph:", err);
      setNodes([]);
      setEdges([]);
      setKeyFacts([]);
    } finally {
      setLoading(false);
    }
  }, [selectedChatId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // Selection inspection details helper
  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  // Find neighbor relationships for detailed node connections inspects
  const nodeConnections = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges
      .map((edge) => {
        if (edge.source === selectedNodeId) {
          const targetNode = nodes.find((n) => n.id === edge.target);
          return {
            neighborId: edge.target,
            neighborName: targetNode?.label || "Unknown Node",
            type: targetNode?.type || "concept",
            direction: "outgoing",
            label: edge.label
          };
        }
        if (edge.target === selectedNodeId) {
          const sourceNode = nodes.find((n) => n.id === edge.source);
          return {
            neighborId: edge.source,
            neighborName: sourceNode?.label || "Unknown Node",
            type: sourceNode?.type || "concept",
            direction: "incoming",
            label: edge.label
          };
        }
        return null;
      })
      .filter((n) => n !== null) as Array<{
        neighborId: string;
        neighborName: string;
        type: string;
        direction: "incoming" | "outgoing";
        label: string;
      }>;
  }, [edges, nodes, selectedNodeId]);

  const handleForgetConcept = async (nodeId: string, nodeLabel: string) => {
    if (!selectedChatId) return;
    if (
      !confirm(
        `Are you sure you want to forget "${nodeLabel}"? This will permanently delete it from the Neo4j Graph DB.`
      )
    )
      return;

    try {
      await api.deleteGraphNode(selectedChatId, nodeLabel);
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setEdges((prev) =>
        prev.filter((e) => e.source !== nodeId && e.target !== nodeId)
      );
      setSelectedNodeId(null);
    } catch (err) {
      console.error("Failed to delete node:", err);
      alert("Error removing node from Neo4j database.");
    }
  };

  const filteredNodes = nodes.filter(
    (n) =>
      n.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      n.desc.toLowerCase().includes(searchTerm.toLowerCase()) ||
      n.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getNodeColor = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes("tech")) return "#818cf8"; // Lavender Indigo
    if (t.includes("project")) return "#38bdf8"; // Sky Blue
    if (t.includes("decision")) return "#fbbf24"; // Amber
    if (t.includes("person") || t.includes("user")) return "#34d399"; // Emerald
    if (t.includes("concept")) return "#6366f1"; // Pure Indigo
    if (t.includes("feature")) return "#f472b6"; // Rose Pink
    return "#c084fc"; // Purple Muted
  };

  const selectedChat = chats.find((c) => c.id === selectedChatId);

  return (
    <div className="flex h-screen bg-background text-primary-text overflow-hidden transition-colors duration-200">
      <Sidebar />

      {/* Main Memory Explorer Panel */}
      <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto space-y-8 relative">
        <div className="absolute top-[10%] right-[5%] w-96 h-96 rounded-full bg-indigo-500/5 blur-[120px] pointer-events-none" />
        
        {/* Title Header */}
        <div className="border-b border-card-border pb-5 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-primary-text tracking-tight flex items-center gap-3">
              <Database className="text-indigo-400 w-8 h-8" />
              Graph Memory Explorer
            </h1>
            <p className="text-sm text-secondary-text mt-1">
              Analyze relationships, concepts, and technologies stored securely in your memory.
            </p>
          </div>
          
          <div className="flex items-center gap-3 self-start md:self-auto">
            {/* Session Selector */}
            <div className="relative">
              <select
                value={selectedChatId || ""}
                onChange={(e) => setSelectedChatId(e.target.value || null)}
                className="text-xs text-primary-text pl-3 pr-8 py-2 rounded-xl border border-card-border bg-card-bg hover:bg-muted-surface cursor-pointer focus:outline-none transition-all appearance-none max-w-[200px] truncate"
              >
                <option value="">Select Session</option>
                {chats.map((chat) => (
                  <option key={chat.id} value={chat.id}>
                    {chat.title}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-secondary-text pointer-events-none"
              />
            </div>
            
            <button
              type="button"
              onClick={fetchGraph}
              disabled={loading}
              className="p-2.5 rounded-xl border border-card-border bg-card-bg hover:bg-muted-surface text-indigo-400 hover:text-indigo-300 cursor-pointer shadow flex items-center gap-2 text-xs font-semibold transition-all disabled:opacity-40"
            >
              <RefreshCw
                size={13}
                className={loading ? "animate-spin" : ""}
              />
              Sync
            </button>
          </div>
        </div>

        {/* 2D Force directed Canvas explorer */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 flex flex-col gap-2">
            <div className="flex justify-between items-center text-xs px-1">
              <span className="text-secondary-text font-semibold flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
                <Network size={12} className="text-indigo-400" />
                {selectedChat ? `Session: ${selectedChat.title}` : "System Memory Map"}
              </span>
              {selectedNodeId && (
                <button
                  onClick={() => setSelectedNodeId(null)}
                  className="text-secondary-text hover:text-primary-text transition-colors cursor-pointer"
                >
                  Clear Selection
                </button>
              )}
            </div>

            {selectedChatId ? (
              nodes.length === 0 && !loading ? (
                <div className="w-full h-[500px] border border-card-border rounded-2xl flex flex-col items-center justify-center bg-card-bg/10 gap-3 text-center p-6 select-none">
                  <Database size={32} className="text-indigo-400/50 animate-pulse" />
                  <p className="text-sm font-semibold text-primary-text">No Graph Context Found</p>
                  <p className="text-xs text-secondary-text max-w-sm">
                    This chat session does not have any entities extracted yet. Go send a message, and OmniMind will automatically build the graph!
                  </p>
                </div>
              ) : (
                <MemoryGraphCanvas
                  nodes={nodes}
                  edges={edges}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                  searchQuery={searchTerm}
                  getNodeColor={getNodeColor}
                />
              )
            ) : (
              <div className="w-full h-[500px] border border-card-border rounded-2xl flex flex-col items-center justify-center bg-card-bg/10 gap-3 text-center p-6 select-none">
                <Network size={32} className="text-zinc-600 animate-pulse" />
                <p className="text-sm font-semibold text-primary-text">No Chat Session Selected</p>
                <p className="text-xs text-secondary-text max-w-sm">
                  Select a session from the dropdown above to view its interactive knowledge graph.
                </p>
              </div>
            )}
          </div>

          {/* Interactive Inspection & Registry Card */}
          <div className="lg:col-span-4 glass-panel border border-card-border bg-card-bg/30 rounded-2xl p-5 flex flex-col h-[525px] overflow-hidden">
            {selectedNode ? (
              // Active detailed Node Connectivity View
              <div className="flex flex-col h-full animate-appear justify-between">
                <div className="space-y-5 overflow-y-auto pr-1">
                  {/* Header */}
                  <div className="space-y-2">
                    <button
                      onClick={() => setSelectedNodeId(null)}
                      className="flex items-center gap-1.5 text-xs text-secondary-text hover:text-primary-text transition-colors cursor-pointer group"
                    >
                      <ArrowLeft size={13} className="group-hover:-translate-x-0.5 transition-transform" />
                      Back to Registry
                    </button>

                    <div className="flex flex-wrap items-start justify-between gap-2 pt-1">
                      <h3 className="text-base font-bold text-primary-text tracking-tight break-all">
                        {selectedNode.label}
                      </h3>
                      <span
                        className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider border shadow-sm"
                        style={{
                          borderColor: `${getNodeColor(selectedNode.type)}40`,
                          backgroundColor: `${getNodeColor(selectedNode.type)}15`,
                          color: getNodeColor(selectedNode.type)
                        }}
                      >
                        {selectedNode.type}
                      </span>
                    </div>
                  </div>

                  {/* Description Box */}
                  <div className="space-y-1.5">
                    <h4 className="text-[10px] font-bold text-secondary-text uppercase tracking-widest">Description</h4>
                    <p className="text-xs text-primary-text leading-relaxed bg-input-bg p-3 rounded-xl border border-card-border font-sans">
                      {selectedNode.desc}
                    </p>
                  </div>

                  {/* Relational Connectivity Links */}
                  <div className="space-y-2.5">
                    <h4 className="text-[10px] font-bold text-secondary-text uppercase tracking-widest flex items-center gap-1">
                      <Share2 size={10} className="text-indigo-400" />
                      Graph Relations ({nodeConnections.length})
                    </h4>
                    
                    {nodeConnections.length === 0 ? (
                      <p className="text-[11px] text-secondary-text italic">No explicit relationships linked to this concept.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {nodeConnections.map((conn, idx) => (
                          <div
                            key={idx}
                            onClick={() => setSelectedNodeId(conn.neighborId)}
                            className="p-2.5 rounded-xl border border-card-border bg-card-bg/20 hover:bg-muted-surface transition-all flex flex-col gap-1 text-[11px] group/item cursor-pointer"
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-mono text-[9px] text-indigo-400 font-bold group-hover/item:text-indigo-300">
                                {conn.direction === "outgoing" ? `→ ${conn.label}` : `← ${conn.label}`}
                              </span>
                              <span
                                className="text-[7px] uppercase font-bold tracking-wider"
                                style={{ color: getNodeColor(conn.type) }}
                              >
                                {conn.type}
                              </span>
                            </div>
                            <span className="font-bold text-primary-text truncate max-w-[190px]">
                              {conn.neighborName}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Forgets Concepts Button */}
                <div className="pt-4 border-t border-card-border">
                  <button
                    onClick={() => handleForgetConcept(selectedNode.id, selectedNode.label)}
                    className="w-full py-2.5 rounded-xl border border-red-500/25 bg-red-950/10 hover:bg-red-950/20 text-red-400 font-semibold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                  >
                    <Trash2 size={13} />
                    Forget Node
                  </button>
                </div>
              </div>
            ) : (
              // Search & List Registry Index View
              <div className="flex flex-col h-full justify-between">
                <div className="space-y-4 flex-1 flex flex-col overflow-hidden">
                  <div>
                    <h3 className="text-sm font-bold text-primary-text flex items-center gap-1.5">
                      Memory Registry
                      <span className="px-1.5 py-0.5 rounded-lg bg-muted-surface text-secondary-text text-[10px] font-mono">
                        {filteredNodes.length}
                      </span>
                    </h3>
                    <p className="text-[10px] text-secondary-text mt-0.5">Click a node to inspect its connectivity properties.</p>
                  </div>

                  {/* Search Input Box */}
                  <div className="relative">
                    <Search
                      className="absolute left-3.5 top-3.5 text-secondary-text"
                      size={13}
                    />
                    <input
                      type="text"
                      placeholder="Search concepts, types..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full text-xs pl-9 p-3 rounded-xl bg-input-bg border border-card-border text-primary-text focus:ring-1 focus:ring-indigo-500/30 focus:border-indigo-500/30 focus:outline-none transition-all placeholder-secondary-text"
                    />
                  </div>

                  {/* Registry List View */}
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    {loading ? (
                      <div className="h-full flex flex-col items-center justify-center space-y-2">
                        <Loader2 className="animate-spin text-indigo-400 w-6 h-6" />
                        <span className="text-[10px] text-secondary-text italic">Syncing graph nodes...</span>
                      </div>
                    ) : filteredNodes.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-xs text-secondary-text italic gap-2 text-center p-4">
                        <Database size={20} className="text-secondary-text" />
                        <span>No matching memory nodes.</span>
                      </div>
                    ) : (
                      filteredNodes.map((node) => (
                        <div
                          key={node.id}
                          onClick={() => setSelectedNodeId(node.id)}
                          className="p-3 rounded-xl border border-card-border bg-card-bg/20 hover:bg-muted-surface cursor-pointer transition-all flex items-start justify-between gap-3 group/row"
                        >
                          <div className="space-y-1 min-w-0">
                            <h4 className="text-xs font-bold text-primary-text flex items-center gap-1.5">
                              <Bookmark
                                size={11}
                                className="text-indigo-400 shrink-0"
                              />
                              <span className="truncate max-w-[110px]">{node.label}</span>
                              <span
                                className="px-1.5 py-0.2 rounded text-[7px] font-bold uppercase tracking-wider border shrink-0 scale-95"
                                style={{
                                  borderColor: `${getNodeColor(node.type)}30`,
                                  backgroundColor: `${getNodeColor(node.type)}10`,
                                  color: getNodeColor(node.type)
                                }}
                              >
                                {node.type}
                              </span>
                            </h4>
                            <p className="text-[10px] text-secondary-text truncate max-w-[190px]">
                              {node.desc}
                            </p>
                          </div>
                          <span className="text-[9px] text-secondary-text uppercase tracking-widest font-mono group-hover/row:text-indigo-400/80 transition-colors">
                            Inspect
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Footer Status Indicators */}
                <div className="pt-3 border-t border-card-border text-[9px] text-secondary-text flex justify-between items-center select-none font-mono">
                  <span>Provider: Neo4j AuraDB</span>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Connected
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Real Entities & Key Facts List Section below the graph */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-card-border pt-8">
          {/* Key Facts list */}
          <div className="glass-panel border border-card-border bg-card-bg/20 rounded-2xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-indigo-300 flex items-center gap-2">
              <Zap size={14} className="text-indigo-400" />
              Session Key Facts ({keyFacts.length})
            </h3>
            {keyFacts.length === 0 ? (
              <p className="text-xs text-secondary-text italic p-4 text-center">No key facts recorded for this session.</p>
            ) : (
              <ul className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
                {keyFacts.map((fact, index) => (
                  <li key={index} className="text-xs text-primary-text bg-input-bg/50 border border-card-border p-3 rounded-xl leading-relaxed">
                    {fact}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Entities Registry List */}
          <div className="glass-panel border border-card-border bg-card-bg/20 rounded-2xl p-6 space-y-4 flex flex-col h-[400px]">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-indigo-300 flex items-center gap-2">
                <Bookmark size={14} className="text-indigo-400" />
                Entity Registry ({filteredNodes.length})
              </h3>
            </div>
            
            {/* List with Delete Button */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {filteredNodes.length === 0 ? (
                <p className="text-xs text-secondary-text italic p-4 text-center">No matching entities found.</p>
              ) : (
                filteredNodes.map((node) => (
                  <div key={node.id} className="p-3 rounded-xl border border-card-border bg-card-bg/30 flex items-start justify-between gap-3 group/entity-row">
                    <div className="space-y-1 min-w-0">
                      <h4 className="text-xs font-bold text-primary-text flex items-center gap-2">
                        <span className="truncate max-w-[150px]">{node.label}</span>
                        <span
                          className="px-1.5 py-0.2 rounded text-[7px] font-bold uppercase tracking-wider border shrink-0"
                          style={{
                            borderColor: `${getNodeColor(node.type)}30`,
                            backgroundColor: `${getNodeColor(node.type)}10`,
                            color: getNodeColor(node.type)
                          }}
                        >
                          {node.type}
                        </span>
                      </h4>
                      <p className="text-[10px] text-secondary-text leading-relaxed">
                        {node.desc}
                      </p>
                    </div>
                    <button
                      onClick={() => handleForgetConcept(node.id, node.label)}
                      className="p-1.5 rounded-lg border border-red-500/10 hover:border-red-500/30 bg-red-950/15 hover:bg-red-950/35 text-red-400 hover:text-red-300 opacity-0 group-hover/entity-row:opacity-100 transition-opacity cursor-pointer shadow-sm"
                      title="Delete Node"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Informative Guidance Card (Obsidian themed) */}
        <div className="p-5 rounded-2xl border border-indigo-500/10 bg-indigo-500/[0.02] flex gap-4 max-w-4xl select-none">
          <Info className="text-indigo-400 shrink-0 mt-0.5" size={18} />
          <div className="space-y-1">
            <h3 className="text-xs font-bold text-indigo-300">
              Interactive 2D Knowledge Graph Operations
            </h3>
            <p className="text-[11px] text-secondary-text leading-relaxed">
              Drag nodes to pull connections and observe dynamic physical settles. Scroll to zoom in and focus on specific clusters, or drag empty canvas space to pan the view. Toggling "Graph Settings" exposes variables to fine-tune repulsion distances, link separation lengths, and centering gravity.
            </p>
            <p className="text-[11px] text-secondary-text leading-relaxed mt-1">
              Select any node to enter <strong>Inspection Mode</strong>, rendering entity summaries and incoming/outgoing relationship linkages. Direct navigation between nodes is supported by clicking connected relations.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
