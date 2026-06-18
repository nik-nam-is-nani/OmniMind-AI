"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";

interface NodeData {
  id: string;
  name: string;
  pos: THREE.Vector3;
  color: string;
  size: number;
  pulseSpeed: number;
  angle: number;
  flashFrames: number;
}

interface Particle {
  mesh: THREE.Mesh;
  curve: THREE.CatmullRomCurve3;
  progress: number;
  speed: number;
  targetNodeId: string;
}

interface AmbientParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
}

export default function NeuralNetworkCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const cameraTargetRef = useRef(new THREE.Vector3(0, 0, 0));

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    let width = container.clientWidth || 500;
    let height = container.clientHeight || 500;

    // Create Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x080808, 0.06);

    // Create Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 13);

    // Create Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2));
    container.appendChild(renderer.domElement);

    // Three-Point Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    const violetLight = new THREE.PointLight(0x8b5cf6, 1.5, 30);
    violetLight.position.set(5, 5, 5);
    scene.add(violetLight);

    const indigoLight = new THREE.PointLight(0x818cf8, 1.0, 30);
    indigoLight.position.set(-5, 3, -3);
    scene.add(indigoLight);

    const emeraldLight = new THREE.PointLight(0x34d399, 0.8, 30);
    emeraldLight.position.set(0, -4, 4);
    scene.add(emeraldLight);

    // Define Organic Node Positions (floating across X, Y, Z space)
    const nodes: NodeData[] = [
      {
        id: "prompt",
        name: "USER PROMPT",
        pos: new THREE.Vector3(-5.2, 0, 1.5),
        color: "#8b5cf6",
        size: 0.45,
        pulseSpeed: 0.01 + Math.random() * 0.02,
        angle: Math.random() * Math.PI * 2,
        flashFrames: 0,
      },
      {
        id: "router",
        name: "ROUTER AGENT",
        pos: new THREE.Vector3(-2.8, 2, -1.2),
        color: "#818cf8",
        size: 0.35,
        pulseSpeed: 0.01 + Math.random() * 0.02,
        angle: Math.random() * Math.PI * 2,
        flashFrames: 0,
      },
      {
        id: "retriever",
        name: "MEMORY RETRIEVER",
        pos: new THREE.Vector3(-2.2, -0.2, 2.2),
        color: "#818cf8",
        size: 0.35,
        pulseSpeed: 0.01 + Math.random() * 0.02,
        angle: Math.random() * Math.PI * 2,
        flashFrames: 0,
      },
      {
        id: "classifier",
        name: "TASK CLASSIFIER",
        pos: new THREE.Vector3(-3, -2, 0.5),
        color: "#818cf8",
        size: 0.35,
        pulseSpeed: 0.01 + Math.random() * 0.02,
        angle: Math.random() * Math.PI * 2,
        flashFrames: 0,
      },
      {
        id: "gemini",
        name: "GEMINI 1.5 PRO",
        pos: new THREE.Vector3(0.2, 2.8, 1.2),
        color: "#a78bfa",
        size: 0.3,
        pulseSpeed: 0.01 + Math.random() * 0.02,
        angle: Math.random() * Math.PI * 2,
        flashFrames: 0,
      },
      {
        id: "groq",
        name: "LLAMA 3 (GROQ)",
        pos: new THREE.Vector3(0.4, 0.8, -2.0),
        color: "#34d399",
        size: 0.3,
        pulseSpeed: 0.01 + Math.random() * 0.02,
        angle: Math.random() * Math.PI * 2,
        flashFrames: 0,
      },
      {
        id: "deepseek",
        name: "DEEPSEEK V3",
        pos: new THREE.Vector3(-0.2, -1.2, -1.2),
        color: "#60a5fa",
        size: 0.3,
        pulseSpeed: 0.01 + Math.random() * 0.02,
        angle: Math.random() * Math.PI * 2,
        flashFrames: 0,
      },
      {
        id: "openrouter",
        name: "OPENROUTER GATEWAY",
        pos: new THREE.Vector3(0.3, -2.8, 2.2),
        color: "#a1a1aa",
        size: 0.3,
        pulseSpeed: 0.01 + Math.random() * 0.02,
        angle: Math.random() * Math.PI * 2,
        flashFrames: 0,
      },
      {
        id: "graph",
        name: "KNOWLEDGE GRAPH",
        pos: new THREE.Vector3(3.2, 1.6, 0.5),
        color: "#6ee7b7",
        size: 0.35,
        pulseSpeed: 0.01 + Math.random() * 0.02,
        angle: Math.random() * Math.PI * 2,
        flashFrames: 0,
      },
      {
        id: "context",
        name: "CONTEXT INJECTOR",
        pos: new THREE.Vector3(2.6, -1.6, -1.8),
        color: "#6ee7b7",
        size: 0.35,
        pulseSpeed: 0.01 + Math.random() * 0.02,
        angle: Math.random() * Math.PI * 2,
        flashFrames: 0,
      },
      {
        id: "response",
        name: "OMNIMIND RESPONSE",
        pos: new THREE.Vector3(5.4, 0, 1.2),
        color: "#8b5cf6",
        size: 0.45,
        pulseSpeed: 0.01 + Math.random() * 0.02,
        angle: Math.random() * Math.PI * 2,
        flashFrames: 0,
      },
    ];

    const nodeGroup = new THREE.Group();
    scene.add(nodeGroup);
    const nodeWakeTargets: { [id: string]: number } = {};
    const wakeTimers: ReturnType<typeof setTimeout>[] = [];

    // Create Billboard label sprite using Canvas 2D
    const createBillboardLabel = (text: string, color: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = 'bold 20px "Geist Mono", monospace';
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = color;
        ctx.shadowBlur = 4;
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
      }
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.1 });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(1.8, 0.45, 1);
      return sprite;
    };

    // Instantiate core spheres, outer breathing shells, and billboarding labels
    const coreMeshes: { [id: string]: THREE.Mesh } = {};
    const outerMeshes: { [id: string]: THREE.Mesh } = {};
    const labelSprites: { [id: string]: THREE.Sprite } = {};

    nodes.forEach((n, index) => {
      nodeWakeTargets[n.id] = 0.1;

      // Core (Solid glowing nucleus)
      const coreGeo = new THREE.SphereGeometry(n.size, 32, 32);
      const coreMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(n.color),
        emissive: new THREE.Color(n.color),
        emissiveIntensity: 1.0,
        roughness: 0.2,
        metalness: 0.1,
        transparent: true,
        opacity: 0.1,
      });
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      coreMesh.position.copy(n.pos);
      nodeGroup.add(coreMesh);
      coreMeshes[n.id] = coreMesh;

      // Outer Shell (Transparent cellular membrane)
      const outerGeo = new THREE.SphereGeometry(n.size * 1.3, 32, 32);
      const outerMat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(n.color),
        transparent: true,
        opacity: 0.015,
        shininess: 30,
        depthWrite: false,
      });
      const outerMesh = new THREE.Mesh(outerGeo, outerMat);
      outerMesh.position.copy(n.pos);
      nodeGroup.add(outerMesh);
      outerMeshes[n.id] = outerMesh;

      // Billboard labels
      const label = createBillboardLabel(n.name, n.color);
      label.position.copy(n.pos);
      label.position.y -= (n.size * 1.3 + 0.35);
      nodeGroup.add(label);
      labelSprites[n.id] = label;

      const wakeTimer = setTimeout(() => {
        nodeWakeTargets[n.id] = 1.0;
      }, 200 + index * 120);
      wakeTimers.push(wakeTimer);
    });

    // Define Connections Flow (User Prompt -> Classifiers -> Providers -> Context/Memory -> Response)
    const connections: [string, string][] = [
      // Layer 1 -> Layer 2
      ["prompt", "router"],
      ["prompt", "retriever"],
      ["prompt", "classifier"],
      // Layer 2 -> Layer 3
      ["router", "gemini"],
      ["router", "groq"],
      ["router", "deepseek"],
      ["router", "openrouter"],
      ["retriever", "gemini"],
      ["retriever", "groq"],
      ["retriever", "deepseek"],
      ["retriever", "openrouter"],
      ["classifier", "gemini"],
      ["classifier", "groq"],
      ["classifier", "deepseek"],
      ["classifier", "openrouter"],
      // Layer 3 -> Layer 4
      ["gemini", "graph"],
      ["gemini", "context"],
      ["groq", "graph"],
      ["groq", "context"],
      ["deepseek", "graph"],
      ["deepseek", "context"],
      ["openrouter", "graph"],
      ["openrouter", "context"],
      // Layer 4 -> Layer 5
      ["graph", "response"],
      ["context", "response"],
    ];

    const particles: Particle[] = [];
    const particleGeo = new THREE.SphereGeometry(0.015, 8, 8);
    const edgeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    });

    connections.forEach(([srcId, destId]) => {
      const srcNode = nodes.find((n) => n.id === srcId)!;
      const destNode = nodes.find((n) => n.id === destId)!;

      // Create CatmullRomCurve3 with 3 control points (Source, organic offset midpoint, target)
      const midPoint = new THREE.Vector3().addVectors(srcNode.pos, destNode.pos).multiplyScalar(0.5);
      const midOffset = new THREE.Vector3(
        (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 1.2
      );
      midPoint.add(midOffset);

      const curve = new THREE.CatmullRomCurve3([srcNode.pos, midPoint, destNode.pos]);

      // Create TubeGeometry connection edge paths (glowing curved tubes)
      const tubeGeo = new THREE.TubeGeometry(curve, 20, 0.008, 6, false);
      const tubeMesh = new THREE.Mesh(tubeGeo, edgeMaterial);
      nodeGroup.add(tubeMesh);

      // Create 3 to 6 particles per connection
      const particleCount = Math.floor(Math.random() * 4) + 3;
      for (let pIdx = 0; pIdx < particleCount; pIdx++) {
        const pMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(srcNode.color),
          transparent: true,
          opacity: 0.8,
        });
        const pMesh = new THREE.Mesh(particleGeo, pMat);
        pMesh.position.copy(srcNode.pos);
        nodeGroup.add(pMesh);

        particles.push({
          mesh: pMesh,
          curve,
          progress: Math.random(), // Distributed starting points
          speed: 0.002 + Math.random() * 0.004, // Speed between 0.002 and 0.006
          targetNodeId: destId,
        });
      }
    });

    // Create 200 Ambient Background drift particles (zinc-600)
    const ambientParticles: AmbientParticle[] = [];
    const ambientGeo = new THREE.SphereGeometry(0.008, 4, 4);
    const ambientMat = new THREE.MeshBasicMaterial({
      color: 0x52525b, // zinc-600
      transparent: true,
      opacity: 0.3,
    });

    for (let i = 0; i < 200; i++) {
      const mesh = new THREE.Mesh(ambientGeo, ambientMat);
      mesh.position.set(
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 10
      );
      scene.add(mesh);

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.005,
        (Math.random() - 0.5) * 0.005,
        (Math.random() - 0.5) * 0.005
      );
      ambientParticles.push({ mesh, velocity });
    }

    // Mouse Move event tracking
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / width) * 2 - 1;
      const y = -((e.clientY - rect.top) / height) * 2 + 1;
      mouseRef.current = { x, y };
    };

    window.addEventListener("mousemove", handleMouseMove);

    // Resize handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 500;
      const h = container.clientHeight || 500;
      width = w;
      height = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);

    // Animation Loop
    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // Slow organic Y rotation
      nodeGroup.rotation.y += 0.0015;

      // Mouse Parallax Camera Target shift (Lerp tracking max 0.3 units)
      const targetCamX = mouseRef.current.x * 0.3;
      const targetCamY = mouseRef.current.y * 0.3;
      
      cameraTargetRef.current.x += (targetCamX - cameraTargetRef.current.x) * 0.02;
      cameraTargetRef.current.y += (targetCamY - cameraTargetRef.current.y) * 0.02;
      
      camera.lookAt(cameraTargetRef.current);

      // Animate flowing connection particles
      particles.forEach((p) => {
        p.progress += p.speed;
        if (p.progress >= 1.0) {
          p.progress = 0.0;
          // Trigger Synaptic Fire Flash
          const targetNode = nodes.find((n) => n.id === p.targetNodeId);
          if (targetNode) {
            targetNode.flashFrames = 20;
          }
        }
        
        // Move particle along curve path
        const point = p.curve.getPointAt(p.progress);
        p.mesh.position.copy(point);
      });

      // Animate core flash logic & outer breathing pulse scaling
      nodes.forEach((n) => {
        const coreMesh = coreMeshes[n.id];
        if (coreMesh) {
          const coreMat = coreMesh.material as THREE.MeshStandardMaterial;
          const targetOpacity = nodeWakeTargets[n.id] ?? 1.0;
          coreMat.opacity += (targetOpacity - coreMat.opacity) * 0.075;

          if (n.flashFrames > 0) {
            n.flashFrames--;
            const flashIntensity = 1.0 + (n.flashFrames / 20.0) * 1.0; // from 2.0 to 1.0
            coreMat.emissiveIntensity = flashIntensity * coreMat.opacity;
          } else {
            coreMat.emissiveIntensity = coreMat.opacity;
          }
        }

        const outerMesh = outerMeshes[n.id];
        if (outerMesh) {
          const outerMat = outerMesh.material as THREE.MeshPhongMaterial;
          const targetOpacity = (nodeWakeTargets[n.id] ?? 1.0) * 0.15;
          outerMat.opacity += (targetOpacity - outerMat.opacity) * 0.075;

          n.angle += n.pulseSpeed;
          const pulseScale = 1.075 + Math.sin(n.angle) * 0.075; // scales between 1.0 and 1.15
          outerMesh.scale.set(pulseScale, pulseScale, pulseScale);
        }

        const label = labelSprites[n.id];
        if (label) {
          const labelMat = label.material as THREE.SpriteMaterial;
          const targetOpacity = nodeWakeTargets[n.id] ?? 1.0;
          labelMat.opacity += (targetOpacity - labelMat.opacity) * 0.075;
        }
      });

      // Animate drift ambient background particles (with boundary bouncing)
      ambientParticles.forEach((ap) => {
        ap.mesh.position.add(ap.velocity);

        if (Math.abs(ap.mesh.position.x) > 9) ap.velocity.x *= -1;
        if (Math.abs(ap.mesh.position.y) > 6) ap.velocity.y *= -1;
        if (Math.abs(ap.mesh.position.z) > 5) ap.velocity.z *= -1;
      });

      renderer.render(scene, camera);
    };

    animate();

    // Clean up Three.js objects
    return () => {
      wakeTimers.forEach((timer) => clearTimeout(timer));
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[400px] md:min-h-0 bg-transparent relative"
    />
  );
}
