"use client";

if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.includes("xxxxxx")) {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_dGVzdC1jbGVyay0xOC5jbGVyay5hY2NvdW50cy5kZXYk";
}
if (process.env.CLERK_SECRET_KEY && process.env.CLERK_SECRET_KEY.includes("xxxxxx")) {
  process.env.CLERK_SECRET_KEY = "sk_test_dGVzdC1jbGVyay0xOC5jbGVyay5hY2NvdW50cy5kZXYk";
}

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageSquare,
  Settings,
  BarChart3,
  Database,
  Plus,
  Trash2,
  Cpu,
  ChevronLeft,
  ChevronRight,
  Edit2,
} from "lucide-react";
import { useUser, useClerk } from "@/lib/auth";
import { api, Chat } from "@/lib/api";

const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const isClerkActive = !!(
  CLERK_PUBLISHABLE_KEY &&
  CLERK_PUBLISHABLE_KEY.startsWith("pk_")
);

interface SidebarProps {
  onSelectChat?: (chatId: string | null) => void;
  activeChatId?: string | null;
}

export default function Sidebar({ activeChatId, onSelectChat }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [chats, setChats] = useState<Chat[]>([]);
  const [savings, setSavings] = useState<{ cost: number; saved: number }>({
    cost: 0.0,
    saved: 0.0,
  });
  const [loading, setLoading] = useState(true);
  
  // Custom interactive states
  const [searchQuery, setSearchQuery] = useState("");
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitleText, setEditingTitleText] = useState("");
  const [favorites, setFavorites] = useState<any[]>([]);

  // Collapse and Hover states
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isExpanded = !isCollapsed || isHovered;

  const { user } = useUser();
  const { signOut } = useClerk();

  const preloadedMessagesRef = React.useRef<Record<string, any>>({});

  const preloadRecentChatMessages = async (chatId: string) => {
    if (!chatId) return;
    try {
      const messages = await api.getMessages(chatId, 50, 0);
      preloadedMessagesRef.current[chatId] = messages;
      if (typeof window !== "undefined") {
        (window as any).__preloadedMessages = {
          chatId,
          messages,
        };
      }
    } catch (err) {
      console.error("Failed to preload messages:", err);
    }
  };

  // Load favorites
  const loadFavorites = () => {
    try {
      const stored = localStorage.getItem("omnimind_favorites");
      if (stored) {
        setFavorites(JSON.parse(stored));
      } else {
        setFavorites([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadFavorites();
    window.addEventListener("favorites_update", loadFavorites);
    return () => window.removeEventListener("favorites_update", loadFavorites);
  }, []);

  // Inline rename submit
  const handleRenameChat = async (chatId: string) => {
    if (!editingTitleText.trim()) return;
    try {
      await api.renameChat(chatId, editingTitleText.trim());
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, title: editingTitleText.trim() } : c));
      setEditingChatId(null);
      setEditingTitleText("");
      // Dispatch title update event so ChatBox updates header too!
      window.dispatchEvent(new Event("chats_update"));
    } catch (err) {
      console.error("Rename chat error:", err);
      alert("Failed to rename session.");
    }
  };

  // Check if session has active status (updated within last hour)
  const isRecent = (updatedAtString?: string, createdAtString?: string) => {
    const timeStr = updatedAtString || createdAtString;
    if (!timeStr) return false;
    try {
      const date = new Date(timeStr);
      const diffMs = new Date().getTime() - date.getTime();
      return diffMs > 0 && diffMs < 60 * 60 * 1000;
    } catch {
      return false;
    }
  };

  // Group chats chronologically
  const getGroupedChats = () => {
    const today: Chat[] = [];
    const yesterday: Chat[] = [];
    const thisWeek: Chat[] = [];
    const older: Chat[] = [];

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    const startOfWeek = new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000);

    const filtered = chats.filter(c => 
      c.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    filtered.forEach(c => {
      const date = new Date(c.created_at);
      const time = date.getTime();
      if (isNaN(time)) {
        older.push(c);
        return;
      }

      if (date >= startOfToday) {
        today.push(c);
      } else if (date >= startOfYesterday) {
        yesterday.push(c);
      } else if (date >= startOfWeek) {
        thisWeek.push(c);
      } else {
        older.push(c);
      }
    });

    return { today, yesterday, thisWeek, older };
  };

  // Load chats and total statistics
  const loadSidebarData = async () => {
    try {
      const chatList = await api.getChats();
      setChats(chatList);
      if (chatList && chatList.length > 0) {
        preloadRecentChatMessages(chatList[0].id);
      }
      
      const stats = await api.getStats();
      setSavings({
        cost: stats.total_cost,
        saved: stats.total_savings,
      });
    } catch (err) {
      console.error("Error loading sidebar data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSidebarData();
    const interval = setInterval(loadSidebarData, 20000);
    
    // Also listen to chat updates triggered locally
    window.addEventListener("chats_update", loadSidebarData);
    
    const handleSessionRenamed = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.chatId && customEvent.detail.title) {
        const { chatId, title } = customEvent.detail;
        console.log("[SESSION RENAMED EVENT]", chatId, title);
        setChats(prev => prev.map(c => c.id === chatId ? { ...c, title } : c));
      }
    };
    window.addEventListener("session_renamed", handleSessionRenamed);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener("chats_update", loadSidebarData);
      window.removeEventListener("session_renamed", handleSessionRenamed);
    };
  }, [pathname, activeChatId]);

  const handleCreateChat = async () => {
    try {
      const newChatResponse = await api.createChat("New Session");
      const createdChat: Chat = {
        id: newChatResponse.chat_id,
        title: newChatResponse.title,
        created_at: new Date().toISOString(),
      };
      setChats((prev) => [createdChat, ...prev]);
      if (onSelectChat) {
        onSelectChat(newChatResponse.chat_id);
      } else {
        router.push(`/?id=${newChatResponse.chat_id}`);
      }
    } catch (err) {
      console.error("Failed to create chat:", err);
    }
  };

  const handleDeleteChat = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (!confirm("Are you sure you want to delete this chat session?")) return;
    try {
      await api.deleteChat(chatId);
      const updatedChats = chats.filter((c) => c.id !== chatId);
      setChats(updatedChats);
      if (activeChatId === chatId) {
        if (updatedChats.length > 0) {
          if (onSelectChat) {
            onSelectChat(updatedChats[0].id);
          } else {
            router.push(`/?id=${updatedChats[0].id}`);
          }
        } else {
          if (onSelectChat) {
            onSelectChat(null);
          }
          router.push("/");
        }
      }
    } catch (err) {
      console.error("Failed to delete chat:", err);
    }
  };

  const handleSignOut = async () => {
    if (!confirm("Do you want to sign out of your session?")) return;
    localStorage.clear();
    sessionStorage.clear();
    if (signOut) {
      try {
        await signOut();
      } catch (err) {
        console.error("Sign out error:", err);
        router.push("/auth");
      }
    } else {
      router.push("/auth");
    }
  };

  // Get user profile details
  const displayEmail = user?.primaryEmailAddress?.emailAddress || "guest@omnimind.ai";
  const displayName = user?.fullName || user?.username || "Guest Developer";
  const userImageUrl = user?.imageUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&h=100&q=80";

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`bg-[#0d0e14] h-screen flex flex-col transition-all duration-300 ease-in-out relative z-20 font-sans ${
        isExpanded ? "w-[240px]" : "w-14"
      }`}
    >
      {/* Collapse Trigger Button (Visible on Hover/Expanded) */}
      <button
        type="button"
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={`absolute -right-3 top-6 bg-[#13141c] border border-white/8 text-zinc-400 p-1 rounded-full cursor-pointer hover:bg-white/5 hover:text-zinc-200 transition-colors duration-150 z-30 shadow-md ${
          isExpanded ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {isCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      {/* Brand Header */}
      <div className={`p-4 flex items-center justify-start ${isExpanded ? "gap-2.5" : "justify-center"}`}>
        <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/8 flex items-center justify-center shrink-0">
          <Cpu className="text-white w-4.5 h-4.5" />
        </div>
        {isExpanded && (
          <span className="text-sm font-normal text-zinc-100 tracking-tight">OmniMind</span>
        )}
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-2 py-4 space-y-6 no-scrollbar">
        {/* Pages Menu */}
        <div>
          {isExpanded ? (
            <div className="px-3 mb-2 flex items-center gap-2 text-zinc-600 select-none">
              <Cpu size={12} />
              <div className="flex-1 border-t border-white/5" />
            </div>
          ) : (
            <div className="w-full border-t border-white/5 my-2.5" />
          )}
          <nav className="space-y-0.5">
            <Link
              href="/"
              className={`flex items-center gap-3 px-3 py-2 text-xs font-normal transition-all duration-150 border-l-2 ${
                pathname === "/"
                  ? "text-zinc-100 border-l-[#4f8ef7] font-medium"
                  : "text-zinc-400 hover:text-zinc-100 border-l-transparent"
              } ${isExpanded ? "" : "justify-center"}`}
              title="Chat Interface"
            >
              <MessageSquare size={15} className="shrink-0" />
              {isExpanded && <span>Chat Rooms</span>}
            </Link>
            
            <Link
              href="/dashboard"
              className={`flex items-center gap-3 px-3 py-2 text-xs font-normal transition-all duration-150 border-l-2 ${
                pathname === "/dashboard"
                  ? "text-zinc-100 border-l-[#4f8ef7] font-medium"
                  : "text-zinc-400 hover:text-zinc-100 border-l-transparent"
              } ${isExpanded ? "" : "justify-center"}`}
              title="Savings Analytics"
            >
              <BarChart3 size={15} className="shrink-0" />
              {isExpanded && <span>Cost Dashboard</span>}
            </Link>
            
            <Link
              href={activeChatId ? `/memory?id=${activeChatId}` : "/memory"}
              className={`flex items-center gap-3 px-3 py-2 text-xs font-normal transition-all duration-150 border-l-2 ${
                pathname === "/memory"
                  ? "text-zinc-100 border-l-[#4f8ef7] font-medium"
                  : "text-zinc-400 hover:text-zinc-100 border-l-transparent"
              } ${isExpanded ? "" : "justify-center"}`}
              title="Knowledge Graph Memory"
            >
              <Database size={15} className="shrink-0" />
              {isExpanded && <span>Memory Graph</span>}
            </Link>
          </nav>
        </div>

        {/* Dynamic Chat Rooms List */}
        <div>
          {isExpanded ? (
            <div className="px-3 mb-2 flex items-center gap-2 text-zinc-600 select-none">
              <MessageSquare size={12} />
              <div className="flex-1 border-t border-white/5" />
            </div>
          ) : (
            <div className="w-full border-t border-white/5 my-2.5" />
          )}

          {/* Session Search Bar */}
          {isExpanded && (
            <div className="px-2 mb-3">
              <input
                type="text"
                placeholder="Search history..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs text-zinc-200 placeholder-zinc-550 bg-[#1e2030] px-3 py-1.5 rounded-lg border border-transparent focus:border-[#4f8ef7]/40 focus:outline-none transition-all duration-150"
              />
            </div>
          )}

          {loading ? (
            isExpanded && (
              <div className="px-3 py-2 text-[10px] text-zinc-500 animate-pulse font-normal">Retrieving logs...</div>
            )
          ) : chats.length === 0 ? (
            isExpanded && (
              <div className="px-3 py-2 text-[10px] text-zinc-500 italic font-normal">No rooms recorded.</div>
            )
          ) : (
            <div className="space-y-4">
              {Object.entries(getGroupedChats()).map(([groupName, groupChats]) => {
                if (groupChats.length === 0) return null;
                return (
                  <div key={groupName} className="space-y-1">
                    {isExpanded && (
                      <p className="px-3 text-[9px] font-semibold text-zinc-650 uppercase tracking-widest select-none">
                        {groupName}
                      </p>
                    )}
                    <div className="space-y-0.5">
                      {groupChats.map((chat) => {
                        const isActive = activeChatId === chat.id;
                        const isEditing = editingChatId === chat.id;
                        const hasActivity = isRecent(chat.updated_at, chat.created_at);
                        
                        return (
                          <div
                            key={chat.id}
                            onClick={() => {
                              if (isEditing) return;
                              if (onSelectChat) {
                                onSelectChat(chat.id);
                              } else {
                                router.push(`/?id=${chat.id}`);
                              }
                            }}
                            className={`group flex items-center justify-between px-3 py-2 text-xs cursor-pointer bg-transparent border-l-2 transition-all duration-150 ${
                              isActive
                                ? "text-zinc-100 border-l-[#4f8ef7] font-medium"
                                : "text-zinc-400 hover:text-zinc-100 border-l-transparent"
                            } ${isExpanded ? "" : "justify-center"}`}
                            title={chat.title}
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <div className="relative shrink-0 flex items-center justify-center">
                                <MessageSquare size={14} className={isActive ? "text-[#4f8ef7]" : "text-zinc-500"} />
                                {/* Dynamic active status green dot */}
                                {hasActivity && (
                                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-500 rounded-full border border-[#0d0e14]" />
                                )}
                              </div>
                              
                              {isExpanded && (
                                <div className="flex-1 min-w-0">
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      autoFocus
                                      value={editingTitleText}
                                      onChange={(e) => setEditingTitleText(e.target.value)}
                                      onBlur={() => handleRenameChat(chat.id)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          handleRenameChat(chat.id);
                                        } else if (e.key === "Escape") {
                                          setEditingChatId(null);
                                        }
                                      }}
                                      className="w-full text-xs text-zinc-150 bg-[#1e2030] px-1.5 py-0.5 rounded border border-[#4f8ef7]/40 focus:outline-none"
                                    />
                                  ) : (
                                    <span 
                                      onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        setEditingChatId(chat.id);
                                        setEditingTitleText(chat.title);
                                      }}
                                      className={`truncate block transition-all duration-300 select-none ${
                                        chat.title === "New Session"
                                          ? "italic text-zinc-550 font-normal"
                                          : "font-normal"
                                      }`}
                                    >
                                      {chat.title}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            
                            {isExpanded && !isEditing && (
                              <button
                                type="button"
                                onClick={(e) => handleDeleteChat(e, chat.id)}
                                className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 p-0.5 rounded transition-all duration-150 cursor-pointer"
                                title="Delete Room"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Favorites / Starred Messages Section */}
        {isExpanded && favorites.length > 0 && (
          <div className="pt-2">
            <div className="px-3 mb-2 flex items-center gap-2 text-zinc-600 select-none">
              <span className="text-[10px] font-semibold uppercase tracking-widest">Favorites</span>
              <div className="flex-1 border-t border-white/5" />
            </div>
            <div className="max-h-40 overflow-y-auto px-2 space-y-1.5 no-scrollbar">
              {favorites.map((msg) => (
                <div
                  key={msg.id}
                  onClick={() => {
                    if (onSelectChat) {
                      onSelectChat(msg.chat_id);
                    } else {
                      router.push(`/?id=${msg.chat_id}`);
                    }
                  }}
                  className="p-2.5 rounded-lg bg-[#13141c]/50 border border-white/5 hover:border-[#4f8ef7]/35 cursor-pointer transition-all duration-150 select-none group/fav"
                  title="Click to view conversation"
                >
                  <p className="text-[10px] text-zinc-350 line-clamp-2 leading-relaxed">
                    {msg.content}
                  </p>
                  <div className="flex items-center justify-between mt-1 text-[8px] font-mono text-zinc-650 group-hover/fav:text-zinc-500">
                    <span>{msg.model || "user"}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Unstar the message
                        const updated = favorites.filter((f: any) => f.id !== msg.id);
                        localStorage.setItem("omnimind_favorites", JSON.stringify(updated));
                        window.dispatchEvent(new Event("favorites_update"));
                      }}
                      className="opacity-0 group-hover/fav:opacity-100 hover:text-red-400 font-semibold"
                    >
                      remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Savings Summary Widget */}
      {isExpanded && (
        <div className="p-3 mx-2 mb-2 rounded-xl border border-white/5 bg-[#13141c]/50 flex flex-col gap-1.5 select-none text-[10px]">
          <div>
            <p className="text-md font-medium text-emerald-400 font-mono leading-none">
              ${savings.saved.toFixed(4)}
            </p>
            <p className="text-[9px] text-zinc-550 mt-1 lowercase tracking-normal font-normal">saved vs premium llm tier</p>
          </div>
          <div className="flex justify-between items-center pt-1 border-t border-white/5">
            <span className="text-zinc-550 lowercase">actual cost:</span>
            <span className="font-medium text-zinc-400 font-mono">${savings.cost.toFixed(4)}</span>
          </div>
        </div>
      )}

      {/* Bottom Controls Row: Profile, New Chat, Settings */}
      <div className={`p-3 border-t border-white/5 bg-[#0d0e14] flex items-center ${isExpanded ? "justify-between" : "justify-center"}`}>
        {/* Profile Avatar / Photo */}
        <div 
          onClick={handleSignOut}
          className="relative shrink-0 cursor-pointer group"
          title={`Signed in as ${displayName} (${displayEmail}). Click to sign out.`}
        >
          <img
            src={userImageUrl}
            alt={displayName}
            className="w-8 h-8 rounded-full border border-white/10 shrink-0 object-cover hover:border-[#4f8ef7] transition-all"
          />
          {isExpanded && (
            <div className="absolute left-10 top-1/2 -translate-y-1/2 bg-[#13141c] border border-white/10 text-[9px] text-zinc-300 px-2 py-1 rounded shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap z-50">
              Sign Out
            </div>
          )}
        </div>

        {/* Action icons (settings, new chat pencil) when expanded */}
        {isExpanded && (
          <div className="flex items-center gap-1.5">
            {/* New Chat Pencil Button */}
            <button
              onClick={handleCreateChat}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-all cursor-pointer"
              title="New Chat Session"
            >
              <Edit2 size={15} />
            </button>

            {/* Settings Gear Button */}
            <Link
              href="/settings"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-all cursor-pointer"
              title="API Settings"
            >
              <Settings size={15} />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
