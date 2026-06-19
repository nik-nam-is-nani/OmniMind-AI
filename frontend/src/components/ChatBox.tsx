"use client";

import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { useUser } from "@/lib/auth";
import { useRouter } from "next/navigation";
import {
  Send,
  Sparkles,
  Bot,
  User,
  DollarSign,
  Coins,
  Cpu,
  RefreshCw,
  AlertTriangle,
  Database,
  Copy,
  Check,
  Edit2,
  RotateCw,
  Bookmark,
  Plus,
  Paperclip,
  XCircle,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronDown,
  Mic,
  MessageSquare,
  Globe,
  FileDown,
} from "lucide-react";
import { api, Message, Chat, getHeaders, getUserId } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

function MessageSkeleton() {
  return (
    <div className="space-y-8 w-full animate-fade-in select-none">
      {/* Row 1: User skeleton */}
      <div className="flex flex-col items-end w-full">
        <div className="flex items-start gap-2.5 max-w-[70%] justify-end w-full">
          <div className="rounded-[18px] rounded-br-[4px] h-10 w-48 shimmer-bg bg-[#1e2d5a]/40 border border-[#4f8ef7]/10" />
        </div>
      </div>
      
      {/* Row 2: Assistant skeleton */}
      <div className="flex flex-col items-start w-full">
        <div className="flex items-start gap-2.5 max-w-[85%] w-full">
          <div className="w-8 h-8 rounded-full shimmer-bg bg-zinc-700/30 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/4 rounded shimmer-bg bg-zinc-700/20" />
            <div className="h-4 w-5/6 rounded shimmer-bg bg-zinc-700/20" />
            <div className="h-4 w-1/2 rounded shimmer-bg bg-zinc-700/20" />
          </div>
        </div>
      </div>

      {/* Row 3: User skeleton */}
      <div className="flex flex-col items-end w-full">
        <div className="flex items-start gap-2.5 max-w-[70%] justify-end w-full">
          <div className="rounded-[18px] rounded-br-[4px] h-12 w-64 shimmer-bg bg-[#1e2d5a]/40 border border-[#4f8ef7]/10" />
        </div>
      </div>
    </div>
  );
}

interface ChatBoxProps {
  chatId: string | null;
  onBack?: () => void;
  initialInput?: string;
  initialFile?: { name: string; text: string; size: number } | null;
}

export default function ChatBox({ chatId, onBack, initialInput, initialFile }: ChatBoxProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [input, setInput] = useState("");
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [routedModel, setRoutedModel] = useState<string | null>(null);
  const [overrideModel, setOverrideModel] = useState<string>(""); // Empty means auto-routing
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Message Actions states
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedInput, setCopiedInput] = useState(false);
  const [exportingPdfId, setExportingPdfId] = useState<string | null>(null);

  // File Upload states and references
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; text: string; size: number; base64Data?: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // User details and profile details for bubble styling
  const { user } = useUser();
  const userImageUrl = user?.imageUrl;
  const userInitials = user?.firstName ? user.firstName[0].toUpperCase() : (user?.username ? user.username[0].toUpperCase() : "U");

  // Interaction feedback, Command Palette, and Reaction states
  const [showFeedbackId, setShowFeedbackId] = useState<string | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [chatTitle, setChatTitle] = useState("Active Session");
  const [allChats, setAllChats] = useState<Chat[]>([]);
  const [reactionStates, setReactionStates] = useState<{[key: string]: string}>({});
  
  useEffect(() => {
    try {
      const stored = localStorage.getItem("omnimind_reactions");
      if (stored) setReactionStates(JSON.parse(stored));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleStarMessage = (msg: Message) => {
    const favs = JSON.parse(localStorage.getItem("omnimind_favorites") || "[]");
    const exists = favs.some((f: any) => f.id === msg.id);
    if (!exists) {
      favs.push(msg);
      localStorage.setItem("omnimind_favorites", JSON.stringify(favs));
      window.dispatchEvent(new Event("favorites_update"));
      alert("Saved to Favorites!");
    } else {
      const updated = favs.filter((f: any) => f.id !== msg.id);
      localStorage.setItem("omnimind_favorites", JSON.stringify(updated));
      window.dispatchEvent(new Event("favorites_update"));
      alert("Removed from Favorites.");
    }
  };

  const handleReaction = (msgId: string, type: "thumbsup" | "thumbsdown" | "star", msg?: Message) => {
    const updated = { ...reactionStates, [msgId]: type };
    setReactionStates(updated);
    localStorage.setItem("omnimind_reactions", JSON.stringify(updated));
    if (type === "star" && msg) {
      handleStarMessage(msg);
    } else if (type === "thumbsup") {
      alert("Liked message!");
    } else if (type === "thumbsdown") {
      setShowFeedbackId(msgId);
    }
  };

  const filteredChats = allChats.filter(c => 
    c.title.toLowerCase().includes(paletteSearch.toLowerCase())
  );

  const handlePaletteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPaletteIndex(prev => (prev + 1) % Math.max(1, filteredChats.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPaletteIndex(prev => (prev - 1 + filteredChats.length) % Math.max(1, filteredChats.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredChats[paletteIndex]) {
        const selectedChat = filteredChats[paletteIndex];
        setShowCommandPalette(false);
        router.push(`/?id=${selectedChat.id}`);
      }
    }
  };

  useEffect(() => {
    setPaletteIndex(0);
  }, [paletteSearch]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInput("");
        setShowFeedbackId(null);
        setShowCommandPalette(false);
      }
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
        setPaletteSearch("");
        api.getChats().then(setAllChats).catch(console.error);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Format time utility
  const formatTime = (isoString?: string) => {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
    } catch {
      return "";
    }
  };

  // Model-specific avatar color indicator
  const getModelColor = (model: string | null | undefined): string => {
    if (!model) return "bg-zinc-500";
    const name = model.toLowerCase();
    if (name.includes("flash") || name.includes("gemini-1.5-flash")) return "bg-violet-500";
    if (name.includes("groq") || name.includes("llama")) return "bg-emerald-500";
    if (name.includes("deepseek")) return "bg-blue-500";
    if (name.includes("pro") || name.includes("gemini-1.5-pro")) return "bg-indigo-500";
    if (name.includes("openrouter")) return "bg-zinc-500";
    return "bg-zinc-500";
  };

  // Thinking state cycling labels
  const thinkingLabels = [
    "Classifying prompt",
    "Selecting model",
    "Retrieving memory",
    "Generating response"
  ];
  const [thinkingIndex, setThinkingIndex] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading && !streamingText) {
      setThinkingIndex(0);
      interval = setInterval(() => {
        setThinkingIndex((prev) => (prev + 1) % thinkingLabels.length);
      }, 800);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [loading, streamingText]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isInitialLoad = useRef(true);
  const hasLoadedMessages = useRef(false);
  const lastChatId = useRef<string | null>(null);
  const isStreaming = useRef(false);
  
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [messagesFade, setMessagesFade] = useState("fade-in"); // "fade-in" | "fade-out" | "fade-hidden"
  const [inputHeight, setInputHeight] = useState(120);

  useEffect(() => {
    if (!inputRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setInputHeight(entry.contentRect.height);
      }
    });
    observer.observe(inputRef.current);
    return () => observer.disconnect();
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (scrollBottom > 200) {
      setShowScrollBottomBtn(true);
    } else {
      setShowScrollBottomBtn(false);
    }
  };

  // Scroll to bottom helper
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Load message logs when chatId changes
  useEffect(() => {
    // Reset all state when chatId changes
    setMessages([]);
    setStreamingText("");
    setLoading(false);
    setError(null);
    setHasMore(false);
    setLoadingMore(false);
    hasLoadedMessages.current = false;

    if (!chatId) {
      lastChatId.current = null;
      return;
    }

    lastChatId.current = chatId;

    // Only run initial messages fetch once, and never again during active streaming sessions
    if (isStreaming.current) {
      return;
    }

    const loadMessages = async () => {
      // Check window.__preloadedMessages first to bypass loading
      if (typeof window !== "undefined" && (window as any).__preloadedMessages?.chatId === chatId) {
        const preloaded = (window as any).__preloadedMessages.messages;
        setMessages(preloaded);
        hasLoadedMessages.current = true;
        setHasMore(preloaded.length >= 50);
        
        try {
          const nameData = await api.getSessionName(chatId);
          setChatTitle(nameData.title || "Active Session");
        } catch {
          setChatTitle("Active Session");
        }
        
        setMessagesFade("fade-in");
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
        isInitialLoad.current = false;
        return;
      }

      // 1. Cross-fade: start fade out of current session's messages
      setMessagesFade("fade-out");
      
      // Wait 150ms for fade out transition to complete
      await new Promise((resolve) => setTimeout(resolve, 150));
      setMessagesFade("fade-hidden");

      setLoading(true);
      setError(null);
      isInitialLoad.current = true; // reset to true so loading positions scroll instantly
      
      try {
        const history = await api.getMessages(chatId);
        
        // Prevent overwrite if streaming started in the meantime
        if (!isStreaming.current) {
          setMessages(history);
          hasLoadedMessages.current = true;
          setHasMore(history.length >= 50);
        }
        
        try {
          const nameData = await api.getSessionName(chatId);
          setChatTitle(nameData.title || "Active Session");
        } catch {
          setChatTitle("Active Session");
        }
        
        // Position scroll container at bottom instantly before showing
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
      } catch (err: any) {
        console.error("Error loading messages:", err);
        setError("Failed to retrieve chat history from server.");
      } finally {
        setLoading(false);
        // Wait 50ms gap before fading in the new session's messages
        setTimeout(() => {
          setMessagesFade("fade-in");
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
          }
          isInitialLoad.current = false;
        }, 50);
      }
    };

    loadMessages();
  }, [chatId]);

  const loadPastMessages = async () => {
    if (!chatId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const currentLength = messages.length;
      const older = await api.getMessages(chatId, 50, currentLength);
      if (older.length > 0) {
        setMessages((prev) => [...older, ...prev]);
        setHasMore(older.length >= 50);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error("Failed to load older messages:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  useLayoutEffect(() => {
    if (chatId && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [chatId]);

  // Handle auto-submitting initial prompt from landing page
  useEffect(() => {
    if (chatId && (initialInput || initialFile) && !loading && messages.length === 0) {
      const sendInitialPrompt = async () => {
        if (initialFile) {
          setUploadedFile(initialFile);
        }
        
        const userQuery = initialInput || "";
        let finalPrompt = userQuery;
        
        if (initialFile) {
          finalPrompt = `[Document Context: ${initialFile.name} (${(initialFile.size / 1024).toFixed(1)} KB extracted content)]\n` +
                        `--- EXTRACTED TEXT CONTENT ---\n` +
                        `${initialFile.text}\n` +
                        `-----------------------------\n\n` +
                        `User Query: ${userQuery}`;
        }
        
        const displayContent = initialFile 
          ? `${userQuery}\n\n📎 *Attached Document: ${initialFile.name}*` 
          : userQuery;

        const tempUserMsg: Message = {
          id: Math.random().toString(),
          chat_id: chatId,
          role: "user",
          content: displayContent,
          model: null,
          input_tokens: 0,
          output_tokens: 0,
          cost: 0,
          savings: 0,
          created_at: new Date().toISOString(),
        };
        setMessages([tempUserMsg]);
        setError(null);
        setStreamingText("");
        setRoutedModel(null);
        try {
          await executeStreamPipeline(userQuery, finalPrompt);
        } catch (err: any) {
          console.error("Error auto-sending initial prompt:", err);
        }
      };
      // Short delay to ensure room has mounted completely
      const t = setTimeout(sendInitialPrompt, 300);
      return () => clearTimeout(t);
    }
  }, [chatId, initialInput, initialFile, messages.length]);

  useEffect(() => {
    if (!scrollContainerRef.current) return;
    if (isInitialLoad.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      const timer = setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
        isInitialLoad.current = false;
      }, 50);
      return () => clearTimeout(timer);
    } else {
      scrollToBottom();
    }
  }, [messages, streamingText]);

  // Expand text area height automatically to fit typed input (max 200px)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input]);

  // File Upload Handlers
  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      await processUploadedFile(file);
    }
  };

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;
          const maxDim = 800;
          
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL("image/jpeg", 0.7));
          } else {
            resolve(event.target?.result as string || "");
          }
        };
        img.onerror = () => {
          resolve(event.target?.result as string || "");
        };
        img.src = event.target?.result as string;
      };
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  };

  const processUploadedFile = async (file: File) => {
    const validExtensions = ["pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls", "txt", "csv", "png", "jpg", "jpeg", "webp", "gif"];
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !validExtensions.includes(ext)) {
      setUploadError(`Unsupported file. Supported: ${validExtensions.join(", ")}`);
      return;
    }

    setUploadingFile(true);
    setUploadError(null);
    setUploadedFile(null);

    try {
      let base64Data: string | undefined = undefined;
      if (file.type.startsWith("image/")) {
        try {
          base64Data = await compressImage(file);
        } catch (compErr) {
          console.warn("Image compression failed:", compErr);
        }
      }

      const res = await api.uploadDocument(file);
      if (res.success) {
        setUploadedFile({
          name: file.name,
          text: res.text,
          size: res.char_count,
          base64Data
        });
      } else {
        setUploadError("Failed to extract data from document.");
      }
    } catch (err: any) {
      console.error("Document upload error:", err);
      setUploadError(err.message || "Failed to parse document content.");
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const clearUploadedFile = () => {
    setUploadedFile(null);
    setUploadError(null);
  };

  // Drag and Drop Callbacks
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      await processUploadedFile(file);
    }
  };

  // Model-specific badge styles (small pills, transparent bg, left border, 15% opacity fills)
  const getModelBadgeStyle = (model: string) => {
    const name = model.toLowerCase();
    if (name.includes("flash")) {
      return "border border-card-border border-l-2 border-l-violet-500 bg-violet-500/10 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400 font-medium";
    }
    if (name.includes("groq") || name.includes("llama")) {
      return "border border-card-border border-l-2 border-l-emerald-500 bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium";
    }
    if (name.includes("deepseek")) {
      return "border border-card-border border-l-2 border-l-blue-500 bg-blue-500/10 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium";
    }
    if (name.includes("pro")) {
      return "border border-card-border border-l-2 border-l-indigo-500 bg-indigo-500/10 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-medium";
    }
    return "border border-card-border border-l-2 border-l-zinc-500 bg-zinc-500/10 dark:bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 font-medium";
  };

  // Core stream execution helper
  const executeStreamPipeline = async (displayQuery: string, actualPrompt?: string, displayContent?: string) => {
    const promptToSend = actualPrompt || displayQuery;
    setLoading(true);
    isStreaming.current = true;
    try {
      const streamUrl = api.getMessageStreamUrl(chatId!);
      const response = await fetch(streamUrl, {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({
          content: promptToSend,
          model_override: overrideModel || null,
          web_search: webSearchEnabled,
          display_content: displayContent || null
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response body stream received.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let completeResponseText = "";
      let memoryActive = 0;
      let memoryEntityCount = 0;
      let memoryRelationshipCount = 0;
      let serverUserMsgId = "";
      let serverAssistantMsgId = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const rawText = decoder.decode(value);
        const lines = rawText.split("\n");

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            
            if (data.model) {
              setRoutedModel(data.model);
            }
            if (data.text) {
              completeResponseText += data.text;
              setStreamingText(completeResponseText);
            }
            if (data.meta) {
              console.log("[METADATA CHUNK]", data.meta);
              memoryActive = data.meta.memory_active ? 1 : 0;
              memoryEntityCount = data.meta.memory_entity_count || 0;
              memoryRelationshipCount = data.meta.memory_relationship_count || 0;
              serverUserMsgId = data.meta.user_message_id || "";
              serverAssistantMsgId = data.meta.assistant_message_id || "";
              if (data.meta.session_title) {
                setChatTitle(data.meta.session_title);
                window.dispatchEvent(new Event("chats_update"));
                window.dispatchEvent(
                  new CustomEvent("session_renamed", {
                    detail: { chatId: chatId!, title: data.meta.session_title },
                  })
                );
              }
            }
            if (data.error) {
              throw new Error(data.error);
            }
          } catch (jsonErr: any) {
            if (line.includes('"error"')) {
              throw new Error(line);
            }
          }
        }
      }

      // Finalize and push the assistant response to local messages state permanently
      const finalizedAssistantMsg: Message = {
        id: serverAssistantMsgId || `assistant-${Date.now()}`,
        chat_id: chatId!,
        role: "assistant",
        content: completeResponseText,
        model: routedModel,
        input_tokens: 0,
        output_tokens: 0,
        cost: 0,
        savings: 0,
        created_at: new Date().toISOString(),
        memory_active: memoryActive,
        memory_entity_count: memoryEntityCount,
        memory_relationship_count: memoryRelationshipCount,
      };

      setMessages((prev) => {
        const newMsgs = [...prev];
        
        // Find and update the user message ID with the real database UUID
        if (serverUserMsgId) {
          for (let i = newMsgs.length - 1; i >= 0; i--) {
            if (newMsgs[i].role === "user") {
              newMsgs[i] = {
                ...newMsgs[i],
                id: serverUserMsgId
              };
              break;
            }
          }
        }

        // Prevent duplicate appending
        const dupIdx = newMsgs.findIndex(m => m.content === completeResponseText && m.role === "assistant");
        if (dupIdx !== -1) {
          newMsgs[dupIdx] = {
            ...newMsgs[dupIdx],
            id: serverAssistantMsgId || newMsgs[dupIdx].id
          };
          return newMsgs;
        }
        return [...newMsgs, finalizedAssistantMsg];
      });
      setStreamingText("");
      setRoutedModel(null);
    } catch (err: any) {
      console.error("Stream pipeline error:", err);
      setError(err.message || "Failed to process chat response stream.");
    } finally {
      setLoading(false);
      isStreaming.current = false;
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !uploadedFile) || !chatId || loading) return;

    let userQuery = input.trim();
    if (!userQuery && uploadedFile) {
      userQuery = "Analyze and summarize this document, highlighting its key structures and content.";
    }

    setInput("");
    setError(null);
    setStreamingText("");
    setRoutedModel(null);

    // Construct display content showing image or regular attachments
    let displayContent = userQuery;
    if (uploadedFile) {
      if (uploadedFile.base64Data) {
        displayContent = `![${uploadedFile.name}](${uploadedFile.base64Data})\n\n${userQuery}`;
      } else {
        displayContent = `${userQuery}\n\n📎 *Attached Document: ${uploadedFile.name}*`;
      }
    }

    // Construct the enriched prompt containing extracted file text for backend context
    let finalPrompt = userQuery;
    if (uploadedFile) {
      finalPrompt = `[Document Context: ${uploadedFile.name} (${(uploadedFile.size / 1024).toFixed(1)} KB extracted content)]\n` +
                    `--- EXTRACTED TEXT CONTENT ---\n` +
                    `${uploadedFile.text}\n` +
                    `-----------------------------\n\n` +
                    `User Query: ${userQuery}`;
    }

    // Instantly append user message locally for snappy UX
    const tempUserMsg: Message = {
      id: `temp-user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      chat_id: chatId,
      role: "user",
      content: displayContent,
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      cost: 0,
      savings: 0,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    // Cache the uploaded file reference locally and clear it for the next input cycle
    const activeFile = uploadedFile;
    clearUploadedFile();

    await executeStreamPipeline(userQuery, finalPrompt, displayContent);
  };

  // User message inline editor
  const handleEditUserMessage = async (msgId: string, originalIndex: number) => {
    if (!editingText.trim() || !chatId || loading) return;

    const updatedText = editingText.trim();
    setEditingMessageId(null);
    setEditingText("");

    // Remove this user message and all subsequent messages
    setMessages((prev) => prev.slice(0, originalIndex));
    setError(null);
    setStreamingText("");
    setRoutedModel(null);

    // Append the edited user message locally
    const tempUserMsg: Message = {
      id: msgId,
      chat_id: chatId,
      role: "user",
      content: updatedText,
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      cost: 0,
      savings: 0,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    await executeStreamPipeline(updatedText);
  };

  // Assistant response regeneration
  const handleRegenerate = async (msgIndex: number) => {
    if (loading || !chatId) return;

    // Find the preceding user message (the prompt)
    let userPrompt = "";
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        userPrompt = messages[i].content;
        break;
      }
    }

    if (!userPrompt) return;

    // Remove the current response and all subsequent responses
    setMessages((prev) => prev.slice(0, msgIndex));
    setError(null);
    setStreamingText("");
    setRoutedModel(null);

    await executeStreamPipeline(userPrompt);
  };

  // Action helpers: Copy & Save
  const handleCopyMessage = (text: string, msgId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMessageId(msgId);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  const handleExportPdf = async (messageId: string) => {
    if (!chatId) return;
    setExportingPdfId(messageId);
    try {
      const blob = await api.downloadMessagePdf(chatId, messageId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `OmniMind_Report_${messageId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Failed to export PDF:", err);
      alert("Failed to export PDF report: " + (err.message || err));
    } finally {
      setExportingPdfId(null);
    }
  };

  const handleCopyInput = () => {
    navigator.clipboard.writeText(input);
    setCopiedInput(true);
    setTimeout(() => setCopiedInput(false), 2000);
  };

  const handleSaveMessage = (msg: Message) => {
    try {
      const existing = localStorage.getItem("saved_messages");
      const saved = existing ? JSON.parse(existing) : [];
      if (!saved.some((s: any) => s.id === msg.id)) {
        saved.push({
          id: msg.id,
          content: msg.content,
          role: msg.role,
          chat_id: msg.chat_id,
          created_at: msg.created_at,
          model: msg.model
        });
        localStorage.setItem("saved_messages", JSON.stringify(saved));
        window.dispatchEvent(new Event("storage_update"));
      }
      alert("Message saved to Sidebar permanently!");
    } catch (e) {
      console.error("Failed to save message:", e);
    }
  };

  // Human-readable Error Parser
  const parseErrorMessage = (rawError: string) => {
    const errorStr = String(rawError);
    if (errorStr.includes("quota") || errorStr.includes("429")) {
      return {
        title: "Gemini quota exceeded - switching to fallback model",
        detail: "API request rate limit reached or credits exhausted. OmniMind is routing to next available tier."
      };
    }
    if (errorStr.includes("Insufficient Balance") || errorStr.includes("402")) {
      return {
        title: "Insufficient API credits on provider",
        detail: "Your account balance is depleted. Please replenish funds on the developer console."
      };
    }
    if (errorStr.includes("not found") || errorStr.includes("404")) {
      return {
        title: "Requested model endpoint not found",
        detail: "Model version might be deprecated or unsupported in this region."
      };
    }
    
    try {
      if (errorStr.startsWith("{") || errorStr.includes('{"error"')) {
        const startIdx = errorStr.indexOf("{");
        const jsonStr = errorStr.substring(startIdx);
        const parsed = JSON.parse(jsonStr);
        const msg = parsed.error?.message || parsed.message || "An external API error occurred.";
        return {
          title: msg.length > 100 ? msg.substring(0, 100) + "..." : msg,
          detail: `Technical code: ${parsed.error?.code || parsed.code || "unknown"}`
        };
      }
    } catch (e) {
      // Fall through
    }
    
    return {
      title: errorStr.length > 100 ? errorStr.substring(0, 100) + "..." : errorStr,
      detail: "Operational gateway interruption details."
    };
  };

  // Styled Error Card inside bubble
  const renderErrorCard = (rawError: string) => {
    const { title, detail } = parseErrorMessage(rawError);
    return (
      <div className="flex gap-3 bg-red-500/5 dark:bg-red-500/10 border border-red-500/20 p-3.5 rounded-xl text-left select-text max-w-xl transition-all duration-150">
        <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center text-white shrink-0 mt-0.5 shadow-sm shadow-red-500/20 animate-pulse">
          <span className="text-[10px] font-bold">!</span>
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-medium text-red-600 dark:text-red-400 leading-snug">{title}</h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono leading-relaxed">{detail}</p>
        </div>
      </div>
    );
  };

  // Part Four: Fade-In Paragraph Response Rendering
  const renderStreamingText = (text: string) => {
    if (!text) return null;
    const paragraphs = text.split("\n\n");
    return (
      <div className="space-y-4">
        {paragraphs.map((p, idx) => {
          const isLast = idx === paragraphs.length - 1;
          return (
            <div
              key={idx}
              className={`paragraph-fade-in ${isLast ? "paragraph-pulsing" : ""}`}
            >
              <div className="inline">
                {renderMarkdown(p)}
              </div>
              {isLast && (
                <span className="streaming-cursor" />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // Part One: Custom Math & Markdown Response Renderer
  const renderMarkdown = (content: string) => {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || "");
            const codeString = String(children).replace(/\n$/, "");
            if (!inline && match) {
              const lang = match[1];
              return (
                <div className="relative border border-white/8 rounded-lg overflow-hidden my-3 group/code select-text">
                  <div className="flex items-center justify-between px-4 py-1.5 bg-[#1e2030] border-b border-white/8 text-[9px] font-mono text-zinc-500">
                    <span className="lowercase font-normal">{lang}</span>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(codeString)}
                      className="flex items-center gap-1 hover:text-zinc-200 transition-colors duration-150 cursor-pointer font-normal"
                    >
                      <Copy size={10} />
                      copy
                    </button>
                  </div>
                  <SyntaxHighlighter
                    style={oneDark}
                    language={lang}
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      borderRadius: 0,
                      fontSize: "12px",
                      background: "#1e2030"
                    }}
                    {...props}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              );
            }
            return (
              <code
                className="px-1.5 py-0.5 rounded bg-[#1e2030] border border-white/8 text-[13px] font-mono text-zinc-200 select-all"
                {...props}
              >
                {children}
              </code>
            );
          },
          table({ children }: any) {
            return (
              <div className="overflow-x-auto my-3 rounded-lg border border-white/8 shadow-sm">
                <table className="min-w-full divide-y divide-white/8 text-[13px]">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }: any) {
            return <thead className="bg-[#1e2030]/50">{children}</thead>;
          },
          tbody({ children }: any) {
            return <tbody className="divide-y divide-white/8 bg-transparent">{children}</tbody>;
          },
          tr({ children }: any) {
            return <tr className="hover:bg-white/3 transition-colors duration-150 odd:bg-transparent even:bg-white/[0.01]">{children}</tr>;
          },
          th({ children }: any) {
            return <th className="px-4 py-2 text-left font-medium text-zinc-500 lowercase tracking-wider text-[10px]">{children}</th>;
          },
          td({ children }: any) {
            return <td className="px-4 py-2 text-zinc-300">{children}</td>;
          },
          h1({ children }: any) {
            return <h1 className="text-lg font-medium text-zinc-100 border-b border-white/8 pb-1 mt-4 mb-2">{children}</h1>;
          },
          h2({ children }: any) {
            return <h2 className="text-md font-medium text-zinc-100 mt-3 mb-1.5">{children}</h2>;
          },
          h3({ children }: any) {
            return <h3 className="text-sm font-medium text-zinc-400 mt-2 mb-1">{children}</h3>;
          },
          ul({ children }: any) {
            return <ul className="list-disc pl-5 my-2 space-y-1.5 text-[15px]">{children}</ul>;
          },
          ol({ children }: any) {
            return <ol className="list-decimal pl-5 my-2 space-y-1.5 text-[15px]">{children}</ol>;
          },
          li({ children }: any) {
            return <li className="text-zinc-300 leading-relaxed font-normal">{children}</li>;
          },
          p({ children }: any) {
            return <p className="paragraph-fade-in leading-relaxed mb-4 text-[15px] text-zinc-300 font-normal">{children}</p>;
          }
        }}
      >
        {content}
      </ReactMarkdown>
    );
  };

  const renderedMessages = useMemo(() => {
    if (loading && !streamingText && messages.length === 0) {
      return <MessageSkeleton />;
    }
    return messages.map((msg, idx) => {
      const isUser = msg.role === "user";
      const isError = !isUser && (msg.content.startsWith("[Error") || msg.content.includes('{"error"'));
      
      if (isUser) {
        return (
          <div
            key={msg.id}
            className="flex flex-col items-end group/message message-appear w-full"
          >
            <div className="flex items-start gap-2.5 max-w-[70%] justify-end">
              <div className="flex-1 min-w-0 flex flex-col items-end">
                {editingMessageId === msg.id ? (
                  <div className="space-y-2 w-full max-w-[580px] bg-[#1e2030] border border-white/8 p-3.5 rounded-2xl shadow-sm">
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="w-full text-sm text-zinc-100 bg-transparent border border-white/8 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#4f8ef7] max-h-32 min-h-[60px] resize-none overflow-y-auto"
                      rows={3}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingMessageId(null)}
                        className="px-3 py-1 text-[11px] font-normal text-zinc-400 hover:text-zinc-200 border border-white/8 rounded-lg transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEditUserMessage(msg.id, idx)}
                        className="px-3 py-1 text-[11px] font-normal text-white bg-[#4f8ef7] hover:bg-[#3b7ee6] rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <Send size={10} />
                        Resubmit
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[18px] rounded-br-[4px] px-4 py-2.5 bg-[#1e2d5a] border border-[#4f8ef7]/30 text-[15px] leading-[1.65] text-zinc-100 text-left w-full">
                    {(() => {
                      const imageRegex = /!\[(.*?)\]\((data:image\/.*?;base64,.*?)\)/g;
                      const matches = [...msg.content.matchAll(imageRegex)];
                      if (matches.length > 0) {
                        const cleanContent = msg.content.replace(imageRegex, "").trim();
                        return (
                          <div className="flex flex-col gap-2.5">
                            {matches.map((match, imageIdx) => (
                              <img
                                key={imageIdx}
                                src={match[2]}
                                alt={match[1] || "Attached Image"}
                                className="max-h-60 object-contain rounded-xl border border-white/10 shadow-sm"
                              />
                            ))}
                            {cleanContent && <p className="whitespace-pre-wrap">{cleanContent}</p>}
                          </div>
                        );
                      }
                      return <p className="whitespace-pre-wrap">{msg.content}</p>;
                    })()}
                  </div>
                )}
              </div>

              <div className="shrink-0 mt-0.5">
                {userImageUrl ? (
                  <img
                    src={userImageUrl}
                    alt="User"
                    className="w-7 h-7 rounded-full object-cover border border-white/10"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-[11px] font-semibold text-zinc-200 border border-white/10">
                    {userInitials}
                  </div>
                )}
              </div>
            </div>

            {/* Actions bar and timestamp under user message */}
            {editingMessageId !== msg.id && (
              <div className="flex items-center gap-3.5 mt-1 mr-9.5 text-[10px] text-zinc-500 select-none">
                <span className="text-zinc-600 font-mono">{formatTime(msg.created_at)}</span>
                <div className="flex items-center gap-3 opacity-0 group-hover/message:opacity-100 transition-opacity duration-150">
                  <button
                    type="button"
                    onClick={() => handleCopyMessage(msg.content, msg.id)}
                    className="hover:text-zinc-300 transition-colors cursor-pointer"
                  >
                    {copiedMessageId === msg.id ? (
                      <span className="text-emerald-400">copied!</span>
                    ) : (
                      <span>copy</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMessageId(msg.id);
                      setEditingText(msg.content);
                    }}
                    className="hover:text-zinc-300 transition-colors cursor-pointer"
                  >
                    edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveMessage(msg)}
                    className="hover:text-zinc-300 transition-colors cursor-pointer"
                  >
                    save
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      }

      // Assistant / Model Response layout
      return (
        <div
          key={msg.id}
          className="flex flex-col items-start group/message message-appear w-full"
        >
          <div className="flex items-start gap-3 w-full max-w-[85%]">
            <div className="shrink-0 mt-2">
              <div className={`w-2.5 h-2.5 rounded-full ${getModelColor(msg.model)}`} />
            </div>
            <div className="flex-1 min-w-0 flex flex-col items-start">
              <div className="rounded-2xl px-1 py-1 bg-transparent text-[15px] leading-[1.65] text-zinc-200 text-left w-full select-text">
                {isError ? renderErrorCard(msg.content) : renderMarkdown(msg.content)}
              </div>

              {/* Model metadata & costs (routing badge sits directly below) */}
              {!isError && (msg.model || msg.cost > 0) && (
                <div className="flex flex-wrap items-center gap-3.5 text-[10px] font-mono text-zinc-500 mt-1 select-none">
                  {msg.model && (
                    <span className="text-[11px] text-zinc-650 font-mono tracking-normal uppercase">
                      {msg.model}
                    </span>
                  )}
                  {msg.cost > 0 && (
                    <span>
                      tokens: {msg.input_tokens + msg.output_tokens}
                    </span>
                  )}
                  {msg.cost > 0 && (
                    <span>
                      cost: ${msg.cost.toFixed(6)}
                    </span>
                  )}
                  {msg.savings > 0 && (
                    <span className="text-emerald-500 font-medium">
                      saved: ${msg.savings.toFixed(6)}
                    </span>
                  )}
                </div>
              )}

              {/* Actions, reactions, feedback and timestamp bar */}
              <div className="flex items-center gap-3.5 opacity-0 group-hover/message:opacity-100 transition-opacity duration-150 mt-2 text-[10px] text-zinc-500 select-none w-full">
                <span className="text-zinc-600 font-mono">{formatTime(msg.created_at)}</span>
                <button
                  type="button"
                  onClick={() => handleCopyMessage(msg.content, msg.id)}
                  className="hover:text-zinc-300 transition-colors cursor-pointer"
                >
                  {copiedMessageId === msg.id ? (
                    <span className="text-emerald-400">copied!</span>
                  ) : (
                    <span>copy</span>
                  )}
                </button>
                {!isError && (
                  <button
                    type="button"
                    onClick={() => handleRegenerate(idx)}
                    className="hover:text-zinc-350 transition-colors cursor-pointer"
                  >
                    regenerate
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleSaveMessage(msg)}
                  className="hover:text-zinc-350 transition-colors cursor-pointer"
                >
                  save
                </button>
                
                {!isError && (
                  <button
                    type="button"
                    onClick={() => handleExportPdf(msg.id)}
                    disabled={exportingPdfId === msg.id}
                    className="hover:text-zinc-350 transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    title="Export this response as styled PDF"
                  >
                    {exportingPdfId === msg.id ? (
                      <>
                        <Loader2 size={10} className="animate-spin" />
                        <span>exporting...</span>
                      </>
                    ) : (
                      <>
                        <FileDown size={10} />
                        <span>export pdf</span>
                      </>
                    )}
                  </button>
                )}
                
                {!isError && (
                  <div className="flex items-center gap-2 border-l border-white/5 pl-3.5">
                    <button
                      type="button"
                      onClick={() => handleReaction(msg.id, "thumbsup")}
                      className={`hover:text-zinc-350 transition-colors cursor-pointer ${
                        reactionStates[msg.id] === "thumbsup" ? "text-emerald-400" : ""
                      }`}
                      title="Like"
                    >
                      👍
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReaction(msg.id, "thumbsdown")}
                      className={`hover:text-zinc-350 transition-colors cursor-pointer ${
                        reactionStates[msg.id] === "thumbsdown" ? "text-red-400" : ""
                      }`}
                      title="Dislike"
                    >
                      👎
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReaction(msg.id, "star", msg)}
                      className={`hover:text-zinc-350 transition-colors cursor-pointer ${
                        reactionStates[msg.id] === "star" ? "text-amber-400" : ""
                      }`}
                      title="Favorite"
                    >
                      ⭐
                    </button>
                  </div>
                )}
                
                {!isError && (
                  <span className="ml-auto flex items-center gap-1 font-mono text-[9px] uppercase font-semibold select-none group/memory relative">
                    <Database size={11} className={msg.memory_active ? "text-violet-400 fill-violet-400/10" : "text-zinc-600"} />
                    <span className={msg.memory_active ? "text-zinc-500 font-normal lowercase" : "text-zinc-600 font-normal lowercase"}>
                      {msg.memory_active ? "memory active" : "no memory"}
                    </span>
                    {msg.memory_active ? (
                      <span className="absolute bottom-full right-0 mb-1 px-2 py-1 rounded bg-[#13141c] border border-white/8 shadow-lg text-[9px] text-zinc-400 font-mono whitespace-nowrap opacity-0 group-hover/memory:opacity-100 transition-opacity duration-150 pointer-events-none z-20 normal-case">
                        Injected: {msg.memory_entity_count || 0} entities, {msg.memory_relationship_count || 0} relationships
                      </span>
                    ) : null}
                  </span>
                )}
              </div>

              {/* Feedback form for thumbs down */}
              {showFeedbackId === msg.id && (
                <div className="mt-2.5 w-full max-w-md bg-[#13141c] border border-white/8 p-3 rounded-xl shadow-md space-y-2 animate-appear">
                  <p className="text-[11px] text-zinc-400 font-sans">Help us improve. What was wrong with this response?</p>
                  <textarea
                    placeholder="Model switched prematurely, inaccurate data, etc..."
                    className="w-full text-xs text-zinc-200 bg-transparent border border-white/8 p-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500/50 resize-none h-16"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        alert("Thank you for your feedback!");
                        setShowFeedbackId(null);
                      }
                    }}
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowFeedbackId(null)}
                      className="px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200 border border-white/8 rounded cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        alert("Thank you for your feedback!");
                        setShowFeedbackId(null);
                      }}
                      className="px-2 py-1 text-[10px] text-white bg-red-500 hover:bg-red-600 rounded cursor-pointer"
                    >
                      Submit
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    messages,
    loading,
    streamingText,
    editingMessageId,
    editingText,
    copiedMessageId,
    reactionStates,
    userImageUrl,
    userInitials,
    exportingPdfId,
    showFeedbackId
  ]);

  // Welcome splash screen for unselected chats
  if (!chatId) {
    return (
      <div className="flex-1 h-screen flex flex-col items-center justify-center p-8 relative overflow-hidden bg-background font-sans">
        <div className="absolute top-[20%] left-[10%] w-72 h-72 rounded-full bg-accent-violet/5 blur-[120px] animate-pulse-glow" />
        <div className="absolute bottom-[20%] right-[10%] w-72 h-72 rounded-full bg-success-val/5 blur-[120px] animate-pulse-glow" />

        <div className="text-center space-y-6 max-w-lg z-10 animate-float">
          <div className="w-16 h-16 rounded-2xl bg-accent-violet flex items-center justify-center mx-auto shadow-lg shadow-accent-violet/25">
            <Sparkles className="text-white w-8 h-8 animate-pulse" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-primary-text tracking-tight">
              Welcome to <span className="text-accent-violet font-extrabold">OmniMind</span>
            </h2>
            <p className="text-xs text-secondary-text max-w-md mx-auto leading-relaxed">
              An intelligent, multi-LLM router chat interface with knowledge graph memory and zero-leak credential encryption.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-left pt-4">
            <div className="p-4 rounded-xl border border-card-border bg-card-bg space-y-2">
              <Cpu className="text-accent-violet w-5 h-5" />
              <h3 className="text-xs font-bold text-primary-text">Cognitive Routing</h3>
              <p className="text-[10px] text-secondary-text leading-relaxed">Automatically directs your query to the cheapest optimized model.</p>
            </div>
            <div className="p-4 rounded-xl border border-card-border bg-card-bg space-y-2">
              <Database className="text-accent-violet w-5 h-5" />
              <h3 className="text-xs font-bold text-primary-text">Graph Memory</h3>
              <p className="text-[10px] text-secondary-text leading-relaxed">Stores entities and cross-session knowledge using Neo4j.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="flex-1 h-screen flex flex-col bg-background relative overflow-hidden font-sans"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Top Header Bar */}
      <div className="bg-[#0d0e14]/85 backdrop-blur-md border-b border-white/8 px-6 py-3.5 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1 rounded-lg border border-white/8 bg-[#13141c] text-zinc-400 hover:text-zinc-150 hover:bg-white/5 transition-all duration-150 cursor-pointer flex items-center justify-center shrink-0"
              title="Return to Landing Page"
            >
              <ChevronLeft size={16} />
            </button>
          )}
          <div>
            <h2 className="font-semibold text-sm text-zinc-200 truncate max-w-[200px] md:max-w-[360px]" title={chatTitle}>
              {chatTitle}
            </h2>
          </div>
        </div>

        {/* Minimal model selector pill with arrow */}
        <div className="relative flex items-center">
          <select
            value={overrideModel}
            onChange={(e) => setOverrideModel(e.target.value)}
            className="appearance-none text-xs text-zinc-400 bg-[#1e2030] hover:text-zinc-200 border border-white/8 rounded-full px-4 py-1.5 pr-8 cursor-pointer focus:outline-none focus:border-[#4f8ef7]/40 transition-colors duration-150"
          >
            <option value="">🔮 auto router</option>
            <option value="gemini-1.5-flash">⚡ gemini flash</option>
            <option value="groq-llama-3">🔥 groq llama</option>
            <option value="deepseek-chat">🧠 deepseek</option>
          </select>
          <div className="absolute right-3 pointer-events-none text-zinc-500">
            <ChevronDown size={12} />
          </div>
        </div>
      </div>

      {/* Messages Scroll View */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto w-full relative no-scrollbar bg-transparent transition-all duration-500 ${
          loading && !streamingText ? "aurora-active" : ""
        }`}
      >
        <div 
          style={{ paddingBottom: `${inputHeight + 32}px` }}
          className={`w-full max-w-[720px] mx-auto px-4 md:px-0 space-y-8 py-6 chat-messages-container ${messagesFade}`}
        >
        {hasMore && (
          <div className="flex justify-center w-full pt-2">
            <button
              type="button"
              disabled={loadingMore}
              onClick={loadPastMessages}
              className="text-xs text-[#4f8ef7] hover:text-[#3b7ee6] bg-[#1e2030] hover:bg-[#282a3e] border border-white/8 rounded-full px-4 py-1.5 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              {loadingMore ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Loading past messages...
                </>
              ) : (
                "Load past conversation"
              )}
            </button>
          </div>
        )}

        {renderedMessages}

        {/* Mock typing indicator for incoming model response */}
        {loading && !streamingText && messages.length > 0 && (
          <div className="flex items-start gap-3 w-full max-w-[85%] message-appear select-none">
            <div className="shrink-0 mt-2">
              <div className="w-2.5 h-2.5 rounded-full bg-zinc-500 animate-pulse" />
            </div>
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex items-center gap-1 px-4 py-2 bg-transparent">
                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" />
              </div>
              <span className="px-4 text-[11px] text-zinc-550 font-mono tracking-normal uppercase">
                {thinkingLabels[thinkingIndex]}
              </span>
            </div>
          </div>
        )}

        {/* Live Streaming Message (floating with routed model badge) */}
        {streamingText && (
          <div className="flex items-start gap-3 w-full max-w-[85%] message-appear select-text">
            <div className="shrink-0 mt-2">
              <div className={`w-2.5 h-2.5 rounded-full ${getModelColor(routedModel)}`} />
            </div>
            <div className="flex-1 min-w-0 flex flex-col items-start">
              <div className="rounded-2xl px-1 py-1 bg-transparent text-[15px] leading-[1.65] text-zinc-350 relative">
                {renderStreamingText(streamingText)}
              </div>
              {routedModel && (
                <div className="px-1 text-[11px] text-zinc-550 font-mono tracking-normal uppercase select-none mt-1">
                  routing -{">"} {routedModel}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty list prompt */}
        {!loading && messages.length === 0 && !streamingText && (
          <div className="h-64 flex flex-col items-center justify-center text-center space-y-2 select-none">
            <Bot size={24} className="text-zinc-600/30 animate-pulse" />
            <p className="text-xs text-zinc-500 italic">Start your conversation.</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>

    <input
      ref={fileInputRef}
      type="file"
      onChange={handleFileChange}
      accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.txt,.csv,.png,.jpg,.jpeg,.webp,.gif"
      className="hidden"
    />    {/* Drag & Drop Visual Overlay Dropzone */}
    {isDragging && (
      <div className="absolute inset-0 bg-[#07070e]/92 z-[100] flex flex-col items-center justify-center border-2 border-dashed border-violet-500 rounded-3xl m-4 animate-appear backdrop-blur-sm pointer-events-none">
        <div className="p-6 rounded-2xl bg-violet-950/20 border border-violet-500/30 flex flex-col items-center gap-3 text-center max-w-sm select-none">
          <div className="w-12 h-12 rounded-xl bg-violet-500/10 flex items-center justify-center shadow-lg border border-violet-500/20">
            <Paperclip className="text-violet-400 w-6 h-6 animate-bounce" />
          </div>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Drop to analyze document</h3>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Release your PDF, Word, PowerPoint, or Excel document to automatically compile and analyze.
          </p>
        </div>
      </div>
    )}

    {/* Part Three: Floating Frosted Input Message Form Box */}
      <div 
        ref={inputRef}
        className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none w-full bg-gradient-to-t from-[#0d0e14] via-[#0d0e14]/90 to-transparent pt-10"
      >
        <div className="w-full max-w-[720px] mx-auto px-4 pb-6 pt-2 pointer-events-auto">
          {/* Document Extraction Progress / Loaded Chips */}
          {(uploadingFile || uploadedFile || uploadError) && (
            <div className="mb-2.5 space-y-1.5 pointer-events-auto max-w-[720px] mx-auto animate-appear">
              {/* Upload Loading Loader state */}
              {uploadingFile && (
                <div className="flex items-center gap-3 p-3 rounded-2xl border border-white/8 bg-[#1e2030] text-xs text-zinc-300 animate-pulse shadow-sm">
                  <Loader2 className="animate-spin w-4 h-4 shrink-0 text-[#4f8ef7]" />
                  <div>
                    <p className="font-semibold text-zinc-200 font-sans">Extracting document details...</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5 font-sans">Reading pages and compiling plain text content</p>
                  </div>
                </div>
              )}

              {/* Upload Success file chip */}
              {uploadedFile && (
                <div className="flex items-center justify-between p-3 rounded-2xl border border-white/8 bg-[#1e2030] text-xs text-zinc-300 shadow-sm animate-appear">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="px-1.5 py-0.5 rounded-lg bg-white/5 border border-white/8 text-zinc-400 text-[8px] font-mono uppercase tracking-wider shrink-0">
                      {uploadedFile.name.split('.').pop()?.toUpperCase()}
                    </span>
                    <span className="truncate font-semibold text-zinc-200">{uploadedFile.name}</span>
                    <span className="text-[9px] text-zinc-500 font-mono">({(uploadedFile.size / 1024).toFixed(1)} KB text)</span>
                  </div>
                  <button
                    type="button"
                    onClick={clearUploadedFile}
                    className="text-zinc-500 hover:text-red-400 p-0.5 rounded cursor-pointer transition-colors"
                    title="Remove attachment"
                  >
                    <XCircle size={14} />
                  </button>
                </div>
              )}

              {/* Upload Error Alert */}
              {uploadError && (
                <div className="flex items-center justify-between p-3 rounded-2xl border border-red-500/20 bg-red-950/10 text-xs text-red-400 shadow-sm animate-appear">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={14} className="shrink-0 text-red-500" />
                    <span className="font-semibold">{uploadError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUploadError(null)}
                    className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded cursor-pointer"
                  >
                    <XCircle size={14} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Scroll to bottom button */}
          <div className="relative flex justify-center">
            {showScrollBottomBtn && (
              <button
                type="button"
                onClick={() => {
                  if (scrollContainerRef.current) {
                    scrollContainerRef.current.scrollTo({
                      top: scrollContainerRef.current.scrollHeight,
                      behavior: "smooth"
                    });
                  }
                }}
                className="absolute top-[-52px] z-20 w-9 h-9 rounded-full bg-[#1e2030] border border-white/10 text-zinc-300 flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer"
                title="Scroll to bottom"
              >
                <ChevronDown size={18} />
              </button>
            )}
          </div>

          <form onSubmit={handleSendMessage} className="relative w-full">
            <div className="flex items-center gap-3 w-full min-h-[56px] px-4 py-2 rounded-[28px] border border-white/8 bg-[#1e2030] shadow-2xl focus-within:border-white/12 transition-all">
              {/* Plus Attachment Button */}
              <button
                type="button"
                onClick={triggerFileSelect}
                disabled={loading || uploadingFile}
                className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all duration-150 shrink-0 cursor-pointer disabled:opacity-40"
                title="Attach Document"
              >
                <Plus size={16} />
              </button>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage(e);
                  }
                }}
                placeholder="Ask OmniMind anything..."
                className="flex-1 text-sm text-zinc-200 placeholder-zinc-500 bg-transparent border-0 focus:ring-0 focus:outline-none max-h-[200px] min-h-[24px] resize-none overflow-y-auto py-1 px-1.5"
                rows={1}
                disabled={loading && !streamingText}
              />

              <div className="flex items-center gap-2 shrink-0">
                {/* Web Search Globe Toggle */}
                <button
                  type="button"
                  onClick={() => setWebSearchEnabled(prev => !prev)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                    webSearchEnabled 
                      ? "text-emerald-400 bg-emerald-950/30 border border-emerald-500/20 hover:bg-emerald-950/50" 
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                  }`}
                  title={webSearchEnabled ? "Web Search Enabled" : "Web Search Disabled"}
                >
                  <Globe size={16} />
                </button>

                {/* Mic Icon */}
                <button
                  type="button"
                  className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all cursor-pointer"
                >
                  <Mic size={16} />
                </button>

                {/* Send Button */}
                <button
                  type="submit"
                  disabled={loading && !streamingText}
                  className={`w-8 h-8 rounded-full flex items-center justify-center bg-[#4f8ef7] text-white hover:bg-[#3b7ee6] active:scale-95 transition-all duration-150 ${
                    (input.trim() || uploadedFile) ? "opacity-100 scale-100" : "opacity-0 scale-90 pointer-events-none"
                  }`}
                  title="Send prompt"
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </form>

          {/* Live tokens, characters, and keyboard shortcut guides */}
          <div className="flex items-center justify-between mt-2.5 px-3 text-[10px] font-mono text-zinc-650 select-none">
            <div className="flex gap-3">
              {input.length > 20 && (
                <>
                  <span>chars: <span className="font-semibold text-zinc-500">{input.length}</span></span>
                  <span>est. tokens: <span className="font-semibold text-zinc-500">{Math.ceil(input.length / 4)}</span></span>
                </>
              )}
            </div>

            <div className="flex items-center gap-3.5">
              {input.trim() && (
                <button
                  type="button"
                  onClick={handleCopyInput}
                  className="flex items-center gap-1 hover:text-zinc-350 transition-colors duration-150 cursor-pointer"
                  title="Copy current input draft"
                >
                  {copiedInput ? (
                    <span className="text-emerald-400 font-semibold">copied!</span>
                  ) : (
                    <span>copy draft</span>
                  )}
                </button>
              )}
              <span>esc: clear | ctrl+enter: send | ctrl+k: search rooms</span>
            </div>
          </div>
        </div>
      </div>

      {/* Command Palette Dialog Overlay */}
      {showCommandPalette && (
        <div className="fixed inset-0 z-50 bg-[#07070e]/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#13141c] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-appear">
            {/* Search Input */}
            <div className="p-4 border-b border-white/8 flex items-center gap-3">
              <Sparkles size={16} className="text-zinc-500 animate-pulse" />
              <input
                type="text"
                autoFocus
                placeholder="Search past chat sessions..."
                value={paletteSearch}
                onChange={(e) => setPaletteSearch(e.target.value)}
                onKeyDown={handlePaletteKeyDown}
                className="flex-1 text-sm text-zinc-100 placeholder-zinc-500 bg-transparent border-none outline-none focus:ring-0"
              />
              <span className="text-[10px] text-zinc-650 border border-white/10 px-1.5 py-0.5 rounded font-mono">ESC to close</span>
            </div>

            {/* Session List */}
            <div className="max-h-60 overflow-y-auto p-2 space-y-0.5 no-scrollbar">
              {filteredChats.length === 0 ? (
                <p className="text-xs text-zinc-500 italic p-4 text-center">No sessions match search query.</p>
              ) : (
                filteredChats.map((c, idx) => {
                  const isSelected = idx === paletteIndex;
                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        setShowCommandPalette(false);
                        router.push(`/?id=${c.id}`);
                      }}
                      className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-all ${
                        isSelected 
                          ? "bg-[#1e2d5a] text-white" 
                          : "text-zinc-400 hover:bg-white/3 hover:text-zinc-200"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <MessageSquare size={14} className={isSelected ? "text-[#4f8ef7]" : "text-zinc-500"} />
                        <span className="text-xs truncate font-medium">{c.title}</span>
                      </div>
                      <span className="text-[9px] text-zinc-500 font-mono select-none">
                        {new Date(c.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
