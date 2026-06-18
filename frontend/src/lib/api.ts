// Unified API Service for OmniMind

if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.includes("xxxxxx")) {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_dGVzdC1jbGVyay0xOC5jbGVyay5hY2NvdW50cy5kZXYk";
}
if (process.env.CLERK_SECRET_KEY && process.env.CLERK_SECRET_KEY.includes("xxxxxx")) {
  process.env.CLERK_SECRET_KEY = "sk_test_dGVzdC1jbGVyay0xOC5jbGVyay5hY2NvdW50cy5kZXYk";
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Check if Clerk is active in environment variables
const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const isClerkActive = !!(
  CLERK_PUBLISHABLE_KEY &&
  CLERK_PUBLISHABLE_KEY.startsWith("pk_")
);

// Heuristic to get a unique user ID. In guest dev mode, returns "dev_user".
export function getUserId(): string {
  if (typeof window !== "undefined") {
    let id = localStorage.getItem("omnimind_guest_user_id");
    if (!id) {
      id = "guest_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem("omnimind_guest_user_id", id);
    }
    return id;
  }
  return "dev_user";
}

// Generates consistent authorization headers for backend calls asynchronously
export async function getHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Try to retrieve Google token if present in localStorage (client-side)
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("omnimind_google_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      return headers;
    }
  }

  // Try to retrieve Clerk token if active and window is defined (client-side)
  if (isClerkActive && typeof window !== "undefined" && (window as any).Clerk?.session) {
    try {
      const token = await (window as any).Clerk.session.getToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        return headers;
      }
    } catch (err) {
      console.warn("Failed to retrieve Clerk JWT token:", err);
    }
  }

  // Fallback for guest dev mode or unauthenticated / local SSR fetches
  const guestId = getUserId();
  headers["Authorization"] = `Bearer ${guestId}`;
  return headers;
}


export interface Chat {
  id: string;
  title: string;
  created_at: string;
  updated_at?: string;
}

export interface Message {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  savings: number;
  created_at: string;
  memory_active?: number;
  memory_entity_count?: number;
  memory_relationship_count?: number;
}

export interface ModelStat {
  model: string;
  count: number;
  cost: number;
  savings: number;
  input_tokens: number;
  output_tokens: number;
}

export interface UserStats {
  total_cost: number;
  total_savings: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_messages: number;
  model_breakdown: ModelStat[];
}

export interface GraphEntity {
  name: string;
  type: string;
  description: string;
}

export interface GraphRelationship {
  source: string;
  target: string;
  type: string;
  description: string;
}

export interface SessionGraph {
  entities: GraphEntity[];
  relationships: GraphRelationship[];
  key_facts?: string[];
}

export interface SettingsResponse {
  gemini_key_configured: boolean;
  groq_key_configured: boolean;
  deepseek_key_configured: boolean;
  openrouter_key_configured: boolean;
  gemini_key_masked: string;
  groq_key_masked: string;
  deepseek_key_masked: string;
  openrouter_key_masked: string;
}

export const api = {
  // Chat Endpoints
  async getChats(): Promise<Chat[]> {
    const res = await fetch(`${API_BASE}/api/chat/`, { headers: await getHeaders() });
    if (!res.ok) throw new Error("Failed to load chat history");
    return res.json();
  },

  async createChat(title: string): Promise<{ chat_id: string; title: string }> {
    const res = await fetch(`${API_BASE}/api/chat/create`, {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error("Failed to create chat");
    return res.json();
  },

  async getMessages(chatId: string, limit?: number, offset?: number): Promise<Message[]> {
    let url = `${API_BASE}/api/chat/${chatId}/messages`;
    const params = new URLSearchParams();
    if (limit !== undefined) params.append("limit", limit.toString());
    if (offset !== undefined) params.append("offset", offset.toString());
    if (params.toString()) url += `?${params.toString()}`;

    const res = await fetch(url, {
      headers: await getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load message history");
    return res.json();
  },

  async deleteChat(chatId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/chat/${chatId}`, {
      method: "DELETE",
      headers: await getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to delete chat");
  },

  async renameChat(chatId: string, title: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/chat/${chatId}/rename`, {
      method: "PUT",
      headers: await getHeaders(),
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error("Failed to rename chat session");
  },

  // Stats Endpoints
  async getStats(): Promise<UserStats> {
    const res = await fetch(`${API_BASE}/api/stats/`, { headers: await getHeaders() });
    if (!res.ok) throw new Error("Failed to load analytics");
    return res.json();
  },

  // Settings Endpoints
  async getSettings(): Promise<SettingsResponse> {
    const res = await fetch(`${API_BASE}/api/settings/`, { headers: await getHeaders() });
    if (!res.ok) throw new Error("Failed to load API settings");
    return res.json();
  },

  async saveSettings(keys: {
    gemini_key?: string;
    groq_key?: string;
    deepseek_key?: string;
    openrouter_key?: string;
  }): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/api/settings/save`, {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify(keys),
    });
    if (!res.ok) throw new Error("Failed to save credentials");
    return res.json();
  },

  async testKey(
    keyType: "gemini" | "groq" | "deepseek" | "openrouter",
    apiKey: string
  ): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/api/settings/test`, {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify({ key_type: keyType, api_key: apiKey }),
    });
    if (!res.ok) throw new Error("Connection test failed");
    return res.json();
  },

  async getSessionGraph(chatId: string): Promise<SessionGraph> {
    const res = await fetch(`${API_BASE}/api/chat/${chatId}/graph`, {
      headers: await getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load session graph");
    return res.json();
  },

  async deleteGraphNode(chatId: string, nodeName: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/chat/${chatId}/graph/${encodeURIComponent(nodeName)}`, {
      method: "DELETE",
      headers: await getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to delete graph node");
  },

  async getSessionName(chatId: string): Promise<{ title: string }> {
    const res = await fetch(`${API_BASE}/api/chat/${chatId}/name`, {
      headers: await getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to get session name");
    return res.json();
  },

  async uploadDocument(file: globalThis.File): Promise<{
    success: boolean;
    filename: string;
    text: string;
    char_count: number;
    word_count: number;
  }> {
    const formData = new FormData();
    formData.append("file", file);
    
    const headers = await getHeaders();
    // Remove Content-Type from headers since fetch dynamically inserts boundary for FormData
    const { "Content-Type": _, ...authHeaders } = headers as any;
    
    const res = await fetch(`${API_BASE}/api/chat/upload-document`, {
      method: "POST",
      headers: authHeaders,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Failed to parse document" }));
      throw new Error(err.detail || "Document extraction failure");
    }
    return res.json();
  },

  async downloadMessagePdf(chatId: string, messageId: string): Promise<Blob> {
    const headers = await getHeaders();
    const res = await fetch(`${API_BASE}/api/chat/${chatId}/message/${messageId}/pdf`, {
      headers,
    });
    if (!res.ok) {
      throw new Error("Failed to download PDF report");
    }
    return res.blob();
  },

  // SSE Stream Message Endpoint Helper
  getMessageStreamUrl(chatId: string): string {
    return `${API_BASE}/api/chat/${chatId}/message`;
  },

  // User Profile Endpoints
  async initUser(profile: {
    email: string;
    display_name?: string;
    nickname?: string;
    avatar_url?: string;
  }): Promise<{
    success: boolean;
    user: any;
    default_chat_created: boolean;
    default_chat_id: string | null;
    chats: Chat[];
  }> {
    const res = await fetch(`${API_BASE}/api/users/init`, {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify(profile),
    });
    if (!res.ok) throw new Error("Failed to initialize user session");
    return res.json();
  },

  async deleteAccount(): Promise<{ success: boolean; clerk_deleted?: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/api/users/me`, {
      method: "DELETE",
      headers: await getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to delete account");
    return res.json();
  }
};
