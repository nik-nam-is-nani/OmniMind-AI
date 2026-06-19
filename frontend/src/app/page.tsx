"use client";


import React, { Suspense, useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useUser, useClerk } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import dynamic from "next/dynamic";
const ChatBox = dynamic(() => import("@/components/ChatBox"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 h-screen flex flex-col items-center justify-center bg-[#0d0e14] text-[#fafafa]">
      <Loader2 className="animate-spin text-indigo-400 w-8 h-8 mb-2" />
      <p className="text-xs text-gray-500">Loading dynamic chat engine...</p>
    </div>
  ),
});
import {
  Loader2,
  Cpu,
  Send,
  Plus,
  Search,
  FileText,
  Sparkles,
  Shield,
  Activity,
  X,
  ChevronRight,
  ChevronDown,
  UserCheck,
  Mic,
} from "lucide-react";
import { api, Chat } from "@/lib/api";

// Check if Clerk is active in environment variables
const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const isClerkActive = !!(
  CLERK_PUBLISHABLE_KEY &&
  CLERK_PUBLISHABLE_KEY.startsWith("pk_")
);

type TransitionState = "landing" | "animating" | "workspace";

function ChatWorkspace({
  initialInput,
  initialFile,
  onBack,
}: {
  initialInput?: string;
  initialFile?: { name: string; text: string; size: number } | null;
  onBack: () => void;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // Sync activeChatId with URL query param '?id=xxxx'
  useEffect(() => {
    const id = searchParams.get("id");
    setActiveChatId(id);
  }, [searchParams]);

  const handleSelectChat = (chatId: string | null) => {
    if (chatId) {
      router.push(`/?id=${chatId}`);
    } else {
      router.push("/");
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-primary-text font-sans landing-fade-enter">
      {/* Sidebar Navigation */}
      <Sidebar activeChatId={activeChatId} onSelectChat={handleSelectChat} />

      {/* Main Chat Interface */}
      <ChatBox
        key={activeChatId}
        chatId={activeChatId}
        onBack={onBack}
        initialInput={initialInput}
        initialFile={initialFile}
      />
    </div>
  );
}

function BaseHomePageContent({
  isLoaded,
  isSignedIn,
  user,
  openSignIn,
  signOut,
}: {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: any;
  openSignIn: () => void;
  signOut?: () => Promise<void> | void;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // State Management
  const [transitionState, setTransitionState] = useState<TransitionState>("landing");
  const [isTransitioningForward, setIsTransitioningForward] = useState(false);
  const [promptInput, setPromptInput] = useState("");
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setSelectedModel(localStorage.getItem("omnimind_selected_model") || "");
    }
  }, []);

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    if (typeof window !== "undefined") {
      localStorage.setItem("omnimind_selected_model", model);
    }
  };
  
  // User Onboarding State
  const [nicknameModalOpen, setNicknameModalOpen] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");
  const [isSavingNickname, setIsSavingNickname] = useState(false);
  const [backendUserProfile, setBackendUserProfile] = useState<any>(null);

  // File Upload State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; text: string; size: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Redirect to auth page if the user is not signed in
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.replace("/auth");
    }
  }, [isLoaded, isSignedIn, router]);

  // Handle routing if query parameters are present on initial load
  useEffect(() => {
    const id = searchParams.get("id");
    if (id) {
      setTransitionState("workspace");
      setActiveChatId(id);
    }
  }, [searchParams]);

  // Synchronize auth status & auto-run onboarding checks
  useEffect(() => {
    if (isLoaded && isSignedIn && user) {
      const handleUserOnboarding = async () => {
        try {
          const res = await api.initUser({
            email: user.primaryEmailAddress?.emailAddress || "guest@omnimind.ai",
            display_name: user.fullName || user.username || "OmniUser",
            avatar_url: user.imageUrl,
          });
          
          setBackendUserProfile(res.user);
          
          // If the profile lacks a nickname, trigger the overlay modal
          if (!res.user.nickname) {
            setNicknameModalOpen(true);
          } else {
            // Retrieve pending prompt if stored prior to login
            const pendingPrompt = localStorage.getItem("omnimind_pending_prompt");
            if (pendingPrompt) {
              localStorage.removeItem("omnimind_pending_prompt");
              handleProceedToChat(pendingPrompt);
            } else {
              // Retrieve user's last chat session to restore their active workspace
              const idParam = searchParams.get("id");
              if (!idParam && res.chats && res.chats.length > 0) {
                const mostRecentChat = res.chats[0];
                if (mostRecentChat) {
                  setTransitionState("workspace");
                  setActiveChatId(mostRecentChat.id);
                  router.push(`/?id=${mostRecentChat.id}`);
                }
              }
            }
          }
        } catch (err) {
          console.error("Failed onboarding registration check:", err);
        }
      };

      handleUserOnboarding();
    }
  }, [isLoaded, isSignedIn, user]);

  const handleSaveNickname = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nicknameInput.trim()) return;

    setIsSavingNickname(true);
    try {
      const res = await api.initUser({
        email: user?.primaryEmailAddress?.emailAddress || "guest@omnimind.ai",
        display_name: user?.fullName || "OmniUser",
        nickname: nicknameInput.trim(),
        avatar_url: user?.imageUrl,
      });
      setBackendUserProfile(res.user);
      setNicknameModalOpen(false);

      // Check for pending prompt to resume
      const pendingPrompt = localStorage.getItem("omnimind_pending_prompt");
      if (pendingPrompt) {
        localStorage.removeItem("omnimind_pending_prompt");
        handleProceedToChat(pendingPrompt);
      }
    } catch (err) {
      console.error("Failed saving user profile nickname:", err);
    } finally {
      setIsSavingNickname(false);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingFile(true);
    setUploadError(null);

    try {
      const result = await api.uploadDocument(file);
      setUploadedFile({
        name: result.filename,
        text: result.text,
        size: result.char_count * 4,
      });
    } catch (err: any) {
      console.error(err);
      setUploadError(err.message || "Failed to scan document context.");
    } finally {
      setUploadingFile(false);
    }
  };



  const handleProceedToChat = async (promptToSend: string) => {
    // If user is not authenticated, save prompt and redirect
    if (!isSignedIn) {
      localStorage.setItem("omnimind_pending_prompt", promptToSend);
      router.push("/auth");
      return;
    }

    try {
      // 1. Pre-create the chat room in the database
      const chatResponse = await api.createChat(promptToSend.slice(0, 30) || "New Session");
      
      setIsTransitioningForward(true);
      setTransitionState("animating");
      
      // Wait 450ms for transitions to complete
      setTimeout(() => {
        setTransitionState("workspace");
        router.push(`/?id=${chatResponse.chat_id}`);
      }, 450);
      
    } catch (err) {
      console.error("Error initiating chat transition:", err);
      setTransitionState("landing");
    }
  };

  const handleSubmitPrompt = (e: React.FormEvent) => {
    e.preventDefault();
    const query = promptInput.trim();
    if (!query && !uploadedFile) return;
    
    handleProceedToChat(query);
  };

  const handleBackToLanding = () => {
    setIsTransitioningForward(false);
    setTransitionState("animating");
    router.push("/");
    
    // Wait 450ms for exit transition to complete before resetting state
    setTimeout(() => {
      setPromptInput("");
      setUploadedFile(null);
      setTransitionState("landing");
    }, 450);
  };

  const nickname = backendUserProfile?.nickname || user?.firstName || "";
  const greeting = nickname ? `Hi ${nickname}, let's get into it` : "Welcome to OmniMind";

  const showWorkspace = transitionState === "workspace" || (transitionState === "animating" && isTransitioningForward);
  const showLanding = transitionState === "landing" || (transitionState === "animating" && !isTransitioningForward);

  return (
    <div className="relative w-screen h-screen bg-background overflow-hidden">
      {/* 1. Landing and Animating View wrapper */}
      {transitionState !== "workspace" && (
        <div 
          className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 bg-[radial-gradient(circle_at_center,rgba(79,142,247,0.01)_0%,transparent_70%)]"
          style={{
            pointerEvents: showLanding ? "auto" : "none",
          }}
        >
          {/* Decorative Blurry Background Blobs - subtle and faint */}
          <div className="absolute top-[15%] left-[25%] w-[450px] h-[450px] rounded-full bg-violet-600/[0.01] blur-[140px] pointer-events-none" />
          <div className="absolute bottom-[15%] right-[25%] w-[450px] h-[450px] rounded-full bg-indigo-600/[0.01] blur-[140px] pointer-events-none" />

          {/* Bottom Radial Glow at viewport edge */}
          <div 
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[80%] h-[150px] rounded-full blur-[100px] pointer-events-none"
            style={{
              background: "radial-gradient(ellipse at bottom, rgba(79, 142, 247, 0.04) 0%, rgba(124, 92, 252, 0.02) 60%, transparent 100%)"
            }}
          />

          {/* Main Container */}
          <div className="w-full max-w-4xl flex flex-col items-center relative z-10">
            
            {/* Onboarding Nickname Modal Overlay */}
            {nicknameModalOpen && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
                <div className="w-full max-w-md bg-card-bg border border-card-border p-8 rounded-2xl shadow-2xl relative animate-float">
                  <div className="text-center space-y-4">
                    <div className="w-12 h-12 bg-violet-500/10 border border-violet-500/20 text-violet-400 rounded-xl flex items-center justify-center mx-auto shadow-md shadow-violet-500/5">
                      <UserCheck size={24} />
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="text-xl font-bold text-primary-text tracking-wide">Choose Your Nickname</h3>
                      <p className="text-xs text-muted-text">
                        Set a nickname to index your secure knowledge vaults.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleSaveNickname} className="mt-6 space-y-4">
                    <input
                      type="text"
                      maxLength={25}
                      required
                      value={nicknameInput}
                      onChange={(e) => setNicknameInput(e.target.value)}
                      placeholder="e.g. Neo, Trinity, Jarvis"
                      className="w-full px-4 py-3 rounded-xl border border-card-border bg-input-bg text-sm text-primary-text placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 focus:shadow-[0_0_10px_rgba(139,92,246,0.15)] transition-all duration-150"
                    />
                    <button
                      type="submit"
                      disabled={isSavingNickname || !nicknameInput.trim()}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs uppercase tracking-wider transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-600/20 cursor-pointer"
                    >
                      {isSavingNickname ? (
                        <Loader2 className="animate-spin w-4 h-4 mx-auto" />
                      ) : (
                        "Save & Initiate Session"
                      )}
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* Large Minimal Greeting */}
            <div
              className="text-center"
              style={{
                opacity: showLanding ? 1 : 0,
                transform: showLanding ? "translateY(0)" : "translateY(-20px)",
                transition: "opacity 200ms ease-out, transform 200ms ease-out",
                transitionDelay: showLanding ? "150ms" : "0ms"
              }}
            >
              <h1 className="text-[36px] font-light text-zinc-100 mt-2 tracking-tight">
                {greeting}
              </h1>
            </div>

            {/* Minimal Input Box */}
            <div
              className="w-full max-w-2xl mt-10 relative z-20"
              style={{
                transform: showLanding ? "translateY(0) scale(1.0)" : "translateY(32vh) scale(0.98)",
                opacity: showLanding ? 1 : 0,
                transition: "transform 350ms cubic-bezier(0.16, 1, 0.3, 1), opacity 350ms ease-out"
              }}
            >
              <form onSubmit={handleSubmitPrompt} className="w-full">
                <div className="flex items-center gap-3 w-full h-[56px] px-4 rounded-[28px] border border-white/8 bg-[#1e2030] shadow-2xl focus-within:border-white/12 transition-all">
                  {/* Plus Icon (Attach Document) */}
                  <button
                    type="button"
                    onClick={triggerFileSelect}
                    disabled={uploadingFile}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all duration-150 shrink-0 cursor-pointer disabled:opacity-40"
                    title="Attach document context"
                  >
                    {uploadingFile ? (
                      <Loader2 className="animate-spin w-4 h-4 text-[#4f8ef7]" />
                    ) : (
                      <Plus size={16} />
                    )}
                  </button>

                  {/* Input field */}
                  <input
                    type="text"
                    value={promptInput}
                    onChange={(e) => setPromptInput(e.target.value)}
                    placeholder="Ask OmniMind anything..."
                    className="flex-1 bg-transparent border-0 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-0 py-1"
                    disabled={uploadingFile}
                  />

                  {/* Right Section Actions */}
                  <div className="flex items-center gap-2.5 shrink-0">
                    {/* Model Selector Pill */}
                    <div className="relative flex items-center bg-[#13141c] border border-white/5 rounded-full px-2.5 py-1 hover:border-white/10 transition-colors">
                      <select
                        value={selectedModel}
                        onChange={(e) => handleModelChange(e.target.value)}
                        className="bg-transparent border-none text-[11px] text-zinc-400 pr-5 pl-1.5 outline-none appearance-none cursor-pointer focus:ring-0 font-normal"
                      >
                        <option value="">🔮 Auto</option>
                        <option value="gemini-1.5-flash">⚡ Gemini Flash</option>
                        <option value="groq-llama-3">🔥 Llama 3</option>
                        <option value="deepseek-chat">🧠 DeepSeek</option>
                        <option value="gemini-1.5-pro">💎 Gemini Pro</option>
                      </select>
                      <ChevronDown size={10} className="text-zinc-500 absolute right-2 pointer-events-none" />
                    </div>

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
                      disabled={uploadingFile}
                      className={`w-8 h-8 rounded-full flex items-center justify-center bg-[#4f8ef7] text-white hover:bg-[#3b7ee6] active:scale-95 transition-all duration-150 ${
                        (promptInput.trim() || uploadedFile) ? "opacity-100 scale-100" : "opacity-0 scale-90 pointer-events-none"
                      }`}
                    >
                      <Send size={14} />
                    </button>
                  </div>
                </div>
              </form>

              {/* Hidden File Input */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.webp,.gif"
                className="hidden"
              />

              {/* Scan File Feedback badges */}
              {(uploadedFile || uploadError || uploadingFile) && (
                <div className="absolute top-full left-0 right-0 mt-3 flex justify-center">
                  {uploadingFile && (
                    <div className="px-3.5 py-1.5 rounded-full border border-violet-500/20 bg-violet-950/20 text-violet-400 text-xs flex items-center gap-2 select-none shadow-md">
                      <Loader2 className="animate-spin w-3.5 h-3.5 text-violet-400" />
                      <span>Extracting document metadata pipelines...</span>
                    </div>
                  )}
                  {uploadedFile && !uploadingFile && (
                    <div className="px-3.5 py-1.5 rounded-full border border-emerald-500/20 bg-emerald-950/20 text-emerald-400 text-xs flex items-center gap-2 select-none shadow-md">
                      <FileText size={13} />
                      <span className="font-medium truncate max-w-[220px]">{uploadedFile.name}</span>
                      <span className="opacity-60 text-[10px] font-mono">({(uploadedFile.size / 1024).toFixed(1)} KB) Loaded</span>
                      <button
                        onClick={() => setUploadedFile(null)}
                        className="text-emerald-400/60 hover:text-emerald-300 p-0.5 rounded cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                  {uploadError && !uploadingFile && (
                    <div className="px-3.5 py-1.5 rounded-full border border-red-500/20 bg-red-950/20 text-red-400 text-xs flex items-center gap-2 select-none shadow-md">
                      <X size={13} />
                      <span>Error: {uploadError}</span>
                      <button
                        onClick={() => setUploadError(null)}
                        className="text-red-400/60 hover:text-red-300 p-0.5 rounded cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* OAuth Authentication Button (Google Sign-In or Guest Sandbox) */}
            <div
              className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
              style={{
                opacity: showLanding ? 1 : 0,
                transform: showLanding ? "translateY(0)" : "translateY(10px)",
                transition: "opacity 200ms ease-out, transform 200ms ease-out",
                transitionDelay: showLanding ? "150ms" : "0ms"
              }}
            >
              {!isSignedIn ? (
                <>
                  <button
                    onClick={() => router.push("/auth")}
                    className="px-6 py-3 rounded-xl border border-card-border bg-card-bg hover:bg-muted-surface text-primary-text font-medium text-xs tracking-wider flex items-center gap-2 cursor-pointer shadow-lg transform active:scale-95 transition-all"
                  >
                    <svg className="w-4 h-4 text-primary-text" viewBox="0 0 24 24">
                      <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="currentColor"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    Continue with Google
                  </button>


                </>
              ) : (
                <div className="flex flex-col items-center gap-2.5">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-card-border bg-card-bg text-[10px] text-secondary-text font-mono shadow-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Identified: {user?.fullName || user?.username || "OmniUser"}</span>
                    <button
                      onClick={() => router.push(activeChatId ? `/?id=${activeChatId}` : "/")}
                      className="ml-2 text-violet-400 hover:text-violet-300 font-bold tracking-wider cursor-pointer"
                    >
                      Workspace →
                    </button>
                  </div>
                  {signOut && (
                    <button
                      onClick={async () => {
                        await signOut();
                        router.push("/auth");
                      }}
                      className="text-[10px] text-muted-text hover:text-red-400 underline underline-offset-2 decoration-card-border transition-colors cursor-pointer"
                    >
                      Switch Account / Sign Out
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Workspace View wrapper */}
      <div 
        className="absolute inset-0 z-0"
        style={{
          opacity: showWorkspace ? 1 : 0,
          pointerEvents: showWorkspace ? "auto" : "none",
          transition: "opacity 300ms ease-out",
          transitionDelay: showWorkspace ? "150ms" : "0ms"
        }}
      >
        {(showWorkspace || transitionState === "animating") && (
          <ChatWorkspace
            initialInput={promptInput}
            initialFile={uploadedFile}
            onBack={handleBackToLanding}
          />
        )}
      </div>
    </div>
  );
}

function HomePageContent() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { openSignIn, signOut } = useClerk();

  return (
    <BaseHomePageContent
      isLoaded={isLoaded}
      isSignedIn={!!isSignedIn}
      user={user}
      openSignIn={openSignIn}
      signOut={signOut}
    />
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-background text-primary-text">
          <Loader2 className="animate-spin text-indigo-400 w-10 h-10 mb-4" />
          <p className="text-xs text-gray-500 italic">Initializing OmniMind Neural Workspace...</p>
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
