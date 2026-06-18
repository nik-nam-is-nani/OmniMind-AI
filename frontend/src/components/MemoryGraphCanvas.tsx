"use client";

import React, { useRef, useEffect, useState } from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sliders,
  Sparkles,
  Eye,
  EyeOff,
  Activity
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

interface SimNode extends Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
  isDragged?: boolean;
}

interface MemoryGraphCanvasProps {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  searchQuery: string;
  getNodeColor: (type: string) => string;
}

export default function MemoryGraphCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  searchQuery,
  getNodeColor
}: MemoryGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Simulation controls state (React-controlled for sliders and toggles)
  const [showLabels, setShowLabels] = useState(true);
  const [showRelations, setShowRelations] = useState(true);
  const [showArrows, setShowArrows] = useState(true);
  const [physicsEnabled, setPhysicsEnabled] = useState(true);
  const [gravityStrength, setGravityStrength] = useState(0.04);
  const [repulsionStrength, setRepulsionStrength] = useState(1500);
  const [linkStrength, setLinkStrength] = useState(0.06);
  const [linkLength, setLinkLength] = useState(130);
  const [showConfig, setShowConfig] = useState(false);

  // References to keep loop values without trigger state updates (enabling 60fps)
  const simNodesRef = useRef<Record<string, SimNode>>({});
  const cameraRef = useRef({ panX: 0, panY: 0, scale: 1.0 });
  const mouseStateRef = useRef({
    x: 0,
    y: 0,
    isPanning: false,
    startX: 0,
    startY: 0,
    draggedNodeId: null as string | null,
    hoveredNodeId: null as string | null
  });

  // Sync incoming props nodes with our simulation node records (preserving positions)
  useEffect(() => {
    const nextSimNodes: Record<string, SimNode> = {};
    const canvas = canvasRef.current;
    const width = canvas ? canvas.width : 600;
    const height = canvas ? canvas.height : 450;

    nodes.forEach((node) => {
      if (simNodesRef.current[node.id]) {
        // Keep existing positions/velocities
        nextSimNodes[node.id] = {
          ...simNodesRef.current[node.id],
          label: node.label,
          type: node.type,
          desc: node.desc
        };
      } else {
        // Spawn randomly near the center
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 80;
        nextSimNodes[node.id] = {
          ...node,
          x: width / 2 + Math.cos(angle) * radius,
          y: height / 2 + Math.sin(angle) * radius,
          vx: 0,
          vy: 0,
          fx: 0,
          fy: 0
        };
      }
    });

    simNodesRef.current = nextSimNodes;
  }, [nodes]);

  // Center camera initially or when nodes load
  const resetCamera = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    cameraRef.current.scale = 1.0;
    cameraRef.current.panX = 0;
    cameraRef.current.panY = 0;
    
    // Position nodes clustered at origin coordinates relative to canvas center
    const simNodes = Object.values(simNodesRef.current);
    if (simNodes.length > 0) {
      // Find bounding box of nodes
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      simNodes.forEach(n => {
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
      });
      const graphCenterX = (minX + maxX) / 2;
      const graphCenterY = (minY + maxY) / 2;
      cameraRef.current.panX = canvas.width / 2 - graphCenterX;
      cameraRef.current.panY = canvas.height / 2 - graphCenterY;
    }
  };

  // Trigger camera reset on mount or when graph transitions from empty to populated
  useEffect(() => {
    if (nodes.length > 0) {
      // Delay slightly for parent dimensions configuration
      const timer = setTimeout(resetCamera, 100);
      return () => clearTimeout(timer);
    }
  }, [nodes.length === 0]);

  // Excite nodes with a jolt of energy
  const exciteGraph = () => {
    Object.values(simNodesRef.current).forEach((node) => {
      node.vx += (Math.random() - 0.5) * 35;
      node.vy += (Math.random() - 0.5) * 35;
    });
  };

  // Visual frame redraw and physics ticker loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;

    const tick = () => {
      // 1. Rescale canvas matching bounding element to prevent blur
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
      }
      const width = rect.width;
      const height = rect.height;

      // 2. Physics Simulation step
      const simNodes = Object.values(simNodesRef.current);
      if (physicsEnabled) {
        // Reset forces
        simNodes.forEach((node) => {
          node.fx = 0;
          node.fy = 0;
        });

        // 2a. Gravity (Centering Force) pull nodes to canvas center
        const cx = width / 2;
        const cy = height / 2;
        simNodes.forEach((node) => {
          node.fx += (cx - node.x) * gravityStrength;
          node.fy += (cy - node.y) * gravityStrength;
        });

        // 2b. Repulsion Force between all nodes (prevents overlaps)
        for (let i = 0; i < simNodes.length; i++) {
          const u = simNodes[i];
          for (let j = i + 1; j < simNodes.length; j++) {
            const v = simNodes[j];
            const dx = v.x - u.x;
            const dy = v.y - u.y;
            const distSq = dx * dx + dy * dy + 0.1;
            const dist = Math.sqrt(distSq);
            
            // Stronger repulsion if nodes are too close
            if (dist < 300) {
              const force = repulsionStrength / distSq;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              u.fx -= fx;
              u.fy -= fy;
              v.fx += fx;
              v.fy += fy;
            }
          }
        }

        // 2c. Edge Spring Force (Attraction between connected nodes)
        edges.forEach((edge) => {
          const u = simNodesRef.current[edge.source];
          const v = simNodesRef.current[edge.target];
          if (!u || !v) return;

          const dx = v.x - u.x;
          const dy = v.y - u.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
          const force = (dist - linkLength) * linkStrength;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          u.fx += fx;
          u.fy += fy;
          v.fx -= fx;
          v.fy -= fy;
        });

        // 2d. Update velocities and coordinates
        const damping = 0.8;
        simNodes.forEach((node) => {
          if (node.isDragged) return; // Keep locked to mouse coordinate
          node.vx = (node.vx + node.fx) * damping;
          node.vy = (node.vy + node.fy) * damping;
          node.x += node.vx;
          node.y += node.vy;
        });
      }

      // 3. Clear Screen and draw dynamic styling based on Light / Dark mode
      const isDark = document.documentElement.classList.contains("dark");
      const bgColor = isDark ? "#07070e" : "#ffffff";
      const gridColor = isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.04)";
      const edgeFadedColor = isDark ? "rgba(255, 255, 255, 0.02)" : "rgba(0, 0, 0, 0.02)";
      const edgeNormalColor = isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.07)";
      const edgeTextBgColor = isDark ? "#07070e" : "#ffffff";
      const edgeTextColor = isDark ? "rgba(255, 255, 255, 0.25)" : "rgba(24, 24, 27, 0.4)";
      const edgeTextHighlightedColor = isDark ? "rgba(129, 140, 248, 0.8)" : "rgba(79, 70, 229, 0.8)";
      const arrowNormalColor = isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.15)";
      const nodeFadedColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)";
      const labelTextSelectedColor = isDark ? "#ffffff" : "#18181b";
      const labelTextNormalColor = (opacityVal: number) => isDark ? `rgba(226, 232, 240, ${opacityVal})` : `rgba(24, 24, 27, ${opacityVal})`;
      const labelBoxBgColor = (opacityVal: number) => isDark ? `rgba(7, 7, 14, ${opacityVal * 0.8})` : `rgba(244, 244, 245, ${opacityVal * 0.8})`;

      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);

      // Save Context for Camera transformation
      ctx.save();
      const { panX, panY, scale } = cameraRef.current;
      ctx.translate(panX, panY);
      ctx.scale(scale, scale);

      // 3a. Draw Background Subtle Dot Grid
      const gridSpacing = 40;
      // Calculate coordinates bounds inside graph coordinates
      const startX = Math.floor(-panX / scale / gridSpacing) * gridSpacing - gridSpacing;
      const endX = startX + (width / scale) + gridSpacing * 2;
      const startY = Math.floor(-panY / scale / gridSpacing) * gridSpacing - gridSpacing;
      const endY = startY + (height / scale) + gridSpacing * 2;

      ctx.fillStyle = gridColor;
      for (let gx = startX; gx < endX; gx += gridSpacing) {
        for (let gy = startY; gy < endY; gy += gridSpacing) {
          ctx.beginPath();
          ctx.arc(gx, gy, 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 3b. Determine Highlight states (hover or search query match)
      const hoveredId = mouseStateRef.current.hoveredNodeId;
      const highlightSet = new Set<string>();
      if (selectedNodeId) highlightSet.add(selectedNodeId);
      if (hoveredId) highlightSet.add(hoveredId);

      // If search query is present, check matching label
      const searchMatches = new Set<string>();
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        simNodes.forEach((n) => {
          if (
            n.label.toLowerCase().includes(q) ||
            n.type.toLowerCase().includes(q)
          ) {
            searchMatches.add(n.id);
          }
        });
      }

      // Collect neighbor nodes of selected or hovered node for contextual highlight
      const neighborNodes = new Set<string>();
      if (highlightSet.size > 0) {
        edges.forEach((edge) => {
          if (highlightSet.has(edge.source)) neighborNodes.add(edge.target);
          if (highlightSet.has(edge.target)) neighborNodes.add(edge.source);
        });
      }

      // Helper to check if a node is faded
      const isFaded = (nodeId: string) => {
        if (highlightSet.size === 0 && searchMatches.size === 0) return false;
        if (highlightSet.has(nodeId)) return false;
        if (searchMatches.has(nodeId)) return false;
        if (neighborNodes.has(nodeId)) return false;
        return true;
      };

      // 3c. Draw Edges (Links)
      edges.forEach((edge) => {
        const u = simNodesRef.current[edge.source];
        const v = simNodesRef.current[edge.target];
        if (!u || !v) return;

        const uFaded = isFaded(u.id);
        const vFaded = isFaded(v.id);
        const isEdgeHighlighted =
          (highlightSet.has(u.id) || highlightSet.has(v.id)) &&
          (highlightSet.has(u.id) || neighborNodes.has(u.id)) &&
          (highlightSet.has(v.id) || neighborNodes.has(v.id));

        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        ctx.lineTo(v.x, v.y);

        // Styling based on state
        if (isEdgeHighlighted) {
          ctx.strokeStyle = "rgba(99, 102, 241, 0.4)";
          ctx.lineWidth = 1.5;
        } else {
          ctx.strokeStyle =
            uFaded || vFaded
              ? edgeFadedColor
              : edgeNormalColor;
          ctx.lineWidth = 0.8;
        }
        ctx.stroke();

        // Draw relationship type label
        if (showRelations && !uFaded && !vFaded) {
          const midX = (u.x + v.x) / 2;
          const midY = (u.y + v.y) / 2;
          ctx.save();
          // Align text with line angle
          const angle = Math.atan2(v.y - u.y, v.x - u.x);
          ctx.translate(midX, midY);
          // Keep text upright
          const normAngle =
            angle > Math.PI / 2 || angle < -Math.PI / 2 ? angle + Math.PI : angle;
          ctx.rotate(normAngle);
          
          ctx.font = "8px monospace";
          ctx.fillStyle = isEdgeHighlighted
            ? edgeTextHighlightedColor
            : edgeTextColor;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          
          // Clear small rect behind text for visibility
          const textWidth = ctx.measureText(edge.label).width;
          ctx.fillStyle = edgeTextBgColor;
          ctx.fillRect(-textWidth / 2 - 2, -7, textWidth + 4, 8);

          ctx.fillStyle = isEdgeHighlighted
            ? edgeTextHighlightedColor
            : edgeTextColor;
          ctx.fillText(edge.label, 0, -1);
          ctx.restore();
        }

        // Draw Link Arrow pointing to target
        if (showArrows && !uFaded && !vFaded) {
          const nodeRadius = 8;
          const arrowLength = 5;
          const arrowWidth = 3.5;
          
          const angle = Math.atan2(v.y - u.y, v.x - u.x);
          // Position arrow point exactly on node boundary
          const targetX = v.x - Math.cos(angle) * nodeRadius;
          const targetY = v.y - Math.sin(angle) * nodeRadius;
          
          ctx.beginPath();
          ctx.moveTo(targetX, targetY);
          ctx.lineTo(
            targetX - Math.cos(angle - Math.PI / 8) * arrowLength,
            targetY - Math.sin(angle - Math.PI / 8) * arrowLength
          );
          ctx.lineTo(
            targetX - Math.cos(angle + Math.PI / 8) * arrowLength,
            targetY - Math.sin(angle + Math.PI / 8) * arrowLength
          );
          ctx.closePath();
          ctx.fillStyle = isEdgeHighlighted
            ? "rgba(99, 102, 241, 0.6)"
            : arrowNormalColor;
          ctx.fill();
        }
      });

      // 3d. Draw Nodes
      simNodes.forEach((node) => {
        const color = getNodeColor(node.type);
        const uFaded = isFaded(node.id);
        const isHovered = hoveredId === node.id;
        const isSelected = selectedNodeId === node.id;
        const isMatch = searchMatches.has(node.id);

        ctx.save();

        // Nodes Shadow Glow (Obsidian style)
        ctx.beginPath();
        ctx.arc(node.x, node.y, isHovered || isSelected ? 8 : 6, 0, Math.PI * 2);

        if (!uFaded) {
          ctx.shadowColor = color;
          ctx.shadowBlur = isHovered || isSelected ? 18 : 8;
        }

        // Base node color with fading
        ctx.fillStyle = uFaded ? nodeFadedColor : color;
        ctx.fill();

        // Selected outline ring
        if (isSelected || isMatch) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, 11, 0, Math.PI * 2);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        ctx.restore();

        // 3e. Draw Text Labels
        if (showLabels) {
          // Fade label opacity depending on zoom scale (Obsidian does this beautifully)
          const scaleOpacity = Math.max(0.1, Math.min(1.0, (scale - 0.3) / 0.7));
          let opacity = uFaded ? 0.08 : scaleOpacity;
          
          // Hovered, selected, or search matches are always shown at max opacity
          if (isHovered || isSelected || isMatch) opacity = 1.0;

          if (opacity > 0.12) {
            ctx.font = `bold ${isHovered || isSelected ? "10px" : "9px"} font-sans`;
            ctx.fillStyle = isHovered || isSelected
              ? labelTextSelectedColor
              : isMatch
              ? color
              : labelTextNormalColor(opacity);
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            
            // Clean text background box so text stays readable
            const labelY = node.y + (isHovered || isSelected ? 11 : 9);
            const textWidth = ctx.measureText(node.label).width;
            
            ctx.fillStyle = labelBoxBgColor(opacity);
            ctx.fillRect(node.x - textWidth / 2 - 3, labelY - 1, textWidth + 6, 11);

            ctx.fillStyle = isHovered || isSelected
              ? labelTextSelectedColor
              : isMatch
              ? color
              : labelTextNormalColor(opacity);
            ctx.fillText(node.label, node.x, labelY);
          }
        }
      });

      ctx.restore();

      // Request next frame
      animationId = requestAnimationFrame(tick);
    };

    animationId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animationId);
  }, [
    physicsEnabled,
    showLabels,
    showRelations,
    showArrows,
    gravityStrength,
    repulsionStrength,
    linkStrength,
    linkLength,
    selectedNodeId,
    searchQuery,
    edges
  ]);

  // Convert client coordinate of screen click into graph simulation coordinates
  const getGraphCoordinates = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { panX, panY, scale } = cameraRef.current;

    const x = (clientX - rect.left - panX) / scale;
    const y = (clientY - rect.top - panY) / scale;
    return { x, y };
  };

  // Check if click hits a node circle (returns Node ID or null)
  const getNodeAtCoord = (x: number, y: number) => {
    const simNodes = Object.values(simNodesRef.current);
    const tolerance = 15; // Padding size to hit small circles easily
    for (const node of simNodes) {
      const dx = node.x - x;
      const dy = node.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 8 + tolerance) {
        return node.id;
      }
    }
    return null;
  };

  // Event handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left click only
    const coord = getGraphCoordinates(e.clientX, e.clientY);
    const clickedNodeId = getNodeAtCoord(coord.x, coord.y);

    if (clickedNodeId) {
      // Start dragging node
      mouseStateRef.current.draggedNodeId = clickedNodeId;
      simNodesRef.current[clickedNodeId].isDragged = true;
      onSelectNode(clickedNodeId);
    } else {
      // Start panning canvas
      mouseStateRef.current.isPanning = true;
      mouseStateRef.current.startX = e.clientX;
      mouseStateRef.current.startY = e.clientY;
      onSelectNode(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const coord = getGraphCoordinates(e.clientX, e.clientY);
    
    // Check hover
    const hoveredNodeId = getNodeAtCoord(coord.x, coord.y);
    mouseStateRef.current.hoveredNodeId = hoveredNodeId;

    if (mouseStateRef.current.draggedNodeId) {
      // Drag node
      const dragNode = simNodesRef.current[mouseStateRef.current.draggedNodeId];
      if (dragNode) {
        dragNode.x = coord.x;
        dragNode.y = coord.y;
        dragNode.vx = 0;
        dragNode.vy = 0;
      }
    } else if (mouseStateRef.current.isPanning) {
      // Pan canvas
      const dx = e.clientX - mouseStateRef.current.startX;
      const dy = e.clientY - mouseStateRef.current.startY;
      cameraRef.current.panX += dx;
      cameraRef.current.panY += dy;
      mouseStateRef.current.startX = e.clientX;
      mouseStateRef.current.startY = e.clientY;
    }
  };

  const handleMouseUp = () => {
    const draggedId = mouseStateRef.current.draggedNodeId;
    if (draggedId && simNodesRef.current[draggedId]) {
      simNodesRef.current[draggedId].isDragged = false;
    }
    mouseStateRef.current.draggedNodeId = null;
    mouseStateRef.current.isPanning = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Zoom math relative to mouse pointer coordinate
    const zoomFactor = 1.1;
    const currentScale = cameraRef.current.scale;
    let nextScale = e.deltaY < 0 ? currentScale * zoomFactor : currentScale / zoomFactor;
    
    // Clamp zoom scale between 0.15x and 6.0x
    nextScale = Math.max(0.15, Math.min(6.0, nextScale));

    const factorRatio = nextScale / currentScale;
    
    // Adjust pan coordinates so mouse focus remains aligned during rescale
    cameraRef.current.panX = mouseX - (mouseX - cameraRef.current.panX) * factorRatio;
    cameraRef.current.panY = mouseY - (mouseY - cameraRef.current.panY) * factorRatio;
    cameraRef.current.scale = nextScale;
  };

  // Zoom click handlers
  const handleZoomClick = (multiplier: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const centerX = canvas.width / 4; // midpoint on display coords
    const centerY = canvas.height / 4;

    const currentScale = cameraRef.current.scale;
    let nextScale = currentScale * multiplier;
    nextScale = Math.max(0.15, Math.min(6.0, nextScale));

    const factorRatio = nextScale / currentScale;
    cameraRef.current.panX = centerX - (centerX - cameraRef.current.panX) * factorRatio;
    cameraRef.current.panY = centerY - (centerY - cameraRef.current.panY) * factorRatio;
    cameraRef.current.scale = nextScale;
  };

  return (
    <div className="relative w-full h-[500px] border border-card-border rounded-2xl overflow-hidden shadow-2xl bg-card-bg/25 flex flex-col group/canvas transition-colors duration-200">
      {/* 2D Render Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="flex-1 w-full h-full cursor-grab active:cursor-grabbing select-none"
      />

      {/* Floating Canvas Action Controls (Obsidian Style) */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
        <div className="flex bg-card-bg/85 border border-card-border p-1 rounded-xl shadow-lg backdrop-blur-md">
          <button
            onClick={() => handleZoomClick(1.25)}
            className="p-2 hover:bg-muted-surface rounded-lg text-secondary-text hover:text-primary-text transition-colors cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn size={15} />
          </button>
          <button
            onClick={() => handleZoomClick(0.8)}
            className="p-2 hover:bg-muted-surface rounded-lg text-secondary-text hover:text-primary-text transition-colors cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut size={15} />
          </button>
          <button
            onClick={resetCamera}
            className="p-2 hover:bg-muted-surface rounded-lg text-secondary-text hover:text-primary-text transition-colors cursor-pointer"
            title="Recenter Camera"
          >
            <Maximize2 size={15} />
          </button>
          <button
            onClick={exciteGraph}
            className="p-2 hover:bg-muted-surface rounded-lg text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer animate-pulse"
            title="Jolt Simulation Energy"
          >
            <Sparkles size={15} />
          </button>
        </div>
      </div>

      {/* Floating Control Toggle / Slider Panel (Right-aligned top) */}
      <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2">
        <button
          onClick={() => setShowConfig(!showConfig)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold backdrop-blur-md cursor-pointer transition-all shadow-md ${
            showConfig
              ? "bg-indigo-600 text-white border-indigo-500 shadow-indigo-600/10"
              : "bg-card-bg/85 border-card-border text-primary-text hover:bg-muted-surface"
          }`}
        >
          <Sliders size={13} />
          <span>Graph Settings</span>
        </button>

        {showConfig && (
          <div className="w-64 bg-card-bg/95 border border-card-border p-4 rounded-2xl shadow-2xl backdrop-blur-lg flex flex-col gap-4 animate-appear text-xs">
            {/* Visual Filters */}
            <div className="space-y-2 border-b border-card-border pb-3">
              <h4 className="font-bold text-secondary-text uppercase tracking-wider text-[9px] mb-1">Display Controls</h4>
              <label className="flex items-center justify-between text-primary-text cursor-pointer">
                <span>Show Labels</span>
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)}
                  className="rounded border-card-border bg-input-bg text-indigo-600 focus:ring-0 cursor-pointer"
                />
              </label>
              <label className="flex items-center justify-between text-primary-text cursor-pointer">
                <span>Show Edge Labels</span>
                <input
                  type="checkbox"
                  checked={showRelations}
                  onChange={(e) => setShowRelations(e.target.checked)}
                  className="rounded border-card-border bg-input-bg text-indigo-600 focus:ring-0 cursor-pointer"
                />
              </label>
              <label className="flex items-center justify-between text-primary-text cursor-pointer">
                <span>Show Edge Directions</span>
                <input
                  type="checkbox"
                  checked={showArrows}
                  onChange={(e) => setShowArrows(e.target.checked)}
                  className="rounded border-card-border bg-input-bg text-indigo-600 focus:ring-0 cursor-pointer"
                />
              </label>
            </div>

            {/* Physics Engine Toggles */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-secondary-text uppercase tracking-wider text-[9px] flex items-center gap-1.5">
                  <Activity size={10} className="text-emerald-400" />
                  Physics Forces
                </h4>
                <button
                  onClick={() => setPhysicsEnabled(!physicsEnabled)}
                  className={`px-2 py-0.5 rounded text-[8px] font-bold tracking-widest uppercase cursor-pointer ${
                    physicsEnabled
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-red-500/10 text-red-400 border border-red-500/20"
                  }`}
                >
                  {physicsEnabled ? "Active" : "Paused"}
                </button>
              </div>

              {/* Gravity Strength */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-secondary-text">
                  <span>Centering Gravity</span>
                  <span className="font-mono">{(gravityStrength * 100).toFixed(0)}</span>
                </div>
                <input
                  type="range"
                  min="0.005"
                  max="0.15"
                  step="0.005"
                  value={gravityStrength}
                  onChange={(e) => setGravityStrength(parseFloat(e.target.value))}
                  className="w-full h-1 bg-card-border rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>

              {/* Repulsion Separation */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-secondary-text">
                  <span>Node Separation</span>
                  <span className="font-mono">{repulsionStrength}</span>
                </div>
                <input
                  type="range"
                  min="100"
                  max="5000"
                  step="100"
                  value={repulsionStrength}
                  onChange={(e) => setRepulsionStrength(parseInt(e.target.value))}
                  className="w-full h-1 bg-card-border rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>

              {/* Spring Link Length */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-secondary-text">
                  <span>Link Separation Distance</span>
                  <span className="font-mono">{linkLength}px</span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="350"
                  step="10"
                  value={linkLength}
                  onChange={(e) => setLinkLength(parseInt(e.target.value))}
                  className="w-full h-1 bg-card-border rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Canvas Status Info */}
      <div className="absolute bottom-4 right-4 bg-card-bg/70 border border-card-border px-3 py-1 rounded-xl text-[9px] text-secondary-text font-mono tracking-wider backdrop-blur-sm pointer-events-none transition-opacity duration-300 opacity-60 group-hover/canvas:opacity-100 flex items-center gap-1.5 select-none">
        <span>Scroll to Zoom</span>
        <span className="w-1.5 h-1.5 rounded-full bg-secondary-text/25" />
        <span>Drag to Pan / Node</span>
      </div>
    </div>
  );
}
