"use client";

if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.includes("xxxxxx")) {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_dGVzdC1jbGVyay0xOC5jbGVyay5hY2NvdW50cy5kZXYk";
}
if (process.env.CLERK_SECRET_KEY && process.env.CLERK_SECRET_KEY.includes("xxxxxx")) {
  process.env.CLERK_SECRET_KEY = "sk_test_dGVzdC1jbGVyay0xOC5jbGVyay5hY2NvdW50cy5kZXYk";
}

import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import {
  Shield,
  CheckCircle,
  XCircle,
  Loader2,
  Lock,
  Eye,
  EyeOff,
  Sparkles
} from "lucide-react";
import { api, SettingsResponse } from "@/lib/api";

const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const isClerkActive = !!(
  CLERK_PUBLISHABLE_KEY &&
  CLERK_PUBLISHABLE_KEY.startsWith("pk_")
);

type ProviderKey = "gemini" | "groq" | "deepseek" | "openrouter";

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse>({
    gemini_key_configured: false,
    groq_key_configured: false,
    deepseek_key_configured: false,
    openrouter_key_configured: false,
    gemini_key_masked: "",
    groq_key_masked: "",
    deepseek_key_masked: "",
    openrouter_key_masked: "",
  });

  // Local inputs
  const [keysInput, setKeysInput] = useState({
    gemini: "",
    groq: "",
    deepseek: "",
    openrouter: "",
  });

  // Visibility states
  const [showKeys, setShowKeys] = useState({
    gemini: false,
    groq: false,
    deepseek: false,
    openrouter: false,
  });

  // Testing states
  const [testing, setTesting] = useState<Record<ProviderKey, boolean>>({
    gemini: false,
    groq: false,
    deepseek: false,
    openrouter: false,
  });

  const [testResult, setTestResult] = useState<Record<ProviderKey, { success: boolean; message: string } | null>>({
    gemini: null,
    groq: null,
    deepseek: null,
    openrouter: null,
  });

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ success: boolean; text: string } | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);

  // Account deletion states
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Fetch current configured keys on load
  const loadSettings = async () => {
    try {
      const current = await api.getSettings();
      setSettings(current);
      // Pre-fill inputs with masked versions so user knows they are set
      setKeysInput({
        gemini: current.gemini_key_masked || "",
        groq: current.groq_key_masked || "",
        deepseek: current.deepseek_key_masked || "",
        openrouter: current.openrouter_key_masked || "",
      });
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoadingSettings(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const toggleVisibility = (provider: ProviderKey) => {
    setShowKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  const handleInputChange = (provider: ProviderKey, val: string) => {
    setKeysInput((prev) => ({ ...prev, [provider]: val }));
    // Reset test results for this key if edited
    setTestResult((prev) => ({ ...prev, [provider]: null }));
  };

  const handleTestKey = async (provider: ProviderKey) => {
    const keyToTest = keysInput[provider];
    if (!keyToTest) {
      setTestResult((prev) => ({
        ...prev,
        [provider]: { success: false, message: "Please enter an API key first." },
      }));
      return;
    }

    setTesting((prev) => ({ ...prev, [provider]: true }));
    setTestResult((prev) => ({ ...prev, [provider]: null }));

    try {
      const res = await api.testKey(provider, keyToTest);
      setTestResult((prev) => ({
        ...prev,
        [provider]: { success: res.success, message: res.message },
      }));
      if (res.success) {
        loadSettings(); // Instantly update configured badges and masks
      }
    } catch (err: any) {
      setTestResult((prev) => ({
        ...prev,
        [provider]: { success: false, message: err.message || "Connection timed out." },
      }));
    } finally {
      setTesting((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      // Format payload: only send keys that are updated (not containing masked representations)
      const payload: Record<string, string> = {};
      
      (Object.keys(keysInput) as ProviderKey[]).forEach((provider) => {
        const val = keysInput[provider];
        if (val && !val.includes("...xxxx")) {
          payload[`${provider}_key`] = val;
        }
      });

      const res = await api.saveSettings(payload);
      if (res.success) {
        setSaveMessage({ success: true, text: "API Configurations securely encrypted and updated." });
        loadSettings(); // Reload masks
      } else {
        setSaveMessage({ success: false, text: res.message || "Failed to update configurations." });
      }
    } catch (err: any) {
      setSaveMessage({ success: false, text: err.message || "Failed to connect to backend server." });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "DELETE") return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await api.deleteAccount();
      if (res.success) {
        alert("Account permanently deleted. Re-routing to landing page.");
        window.location.href = "/";
      } else {
        setDeleteError(res.message || "Failed to delete account.");
        setIsDeleting(false);
      }
    } catch (err: any) {
      setDeleteError(err.message || "Failed to request account deletion.");
      setIsDeleting(false);
    }
  };

  const providers = [
    {
      id: "gemini" as ProviderKey,
      name: "Google Gemini 1.5 API",
      desc: "Powers creative, general-purpose prompts, and graph memory updates.",
      placeholder: "AIzaSy...",
      badge: "Free Tier Available",
      badgeColor: "border border-card-border border-l-2 border-l-violet-500 bg-violet-500/10 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400 font-medium",
    },
    {
      id: "groq" as ProviderKey,
      name: "Groq Cloud API",
      desc: "Powers summaries, descriptions, and highly responsive textual explanations.",
      placeholder: "gsk_...",
      badge: "Free Llama 3 / Mixtral",
      badgeColor: "border border-card-border border-l-2 border-l-emerald-500 bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium",
    },
    {
      id: "deepseek" as ProviderKey,
      name: "DeepSeek API",
      desc: "Powers complex logic, analytical calculations, and mathematical reasoning.",
      placeholder: "sk-...",
      badge: "Near-Free / Low Cost",
      badgeColor: "border border-card-border border-l-2 border-l-blue-500 bg-blue-500/10 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium",
    },
    {
      id: "openrouter" as ProviderKey,
      name: "OpenRouter API",
      desc: "Aggregates open-source models; serves as a universal failover network.",
      placeholder: "sk-or-...",
      badge: "Universal Fallback",
      badgeColor: "border border-card-border border-l-2 border-l-zinc-500 bg-zinc-500/10 dark:bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 font-medium",
    },
  ];

  return (
    <div className="flex h-screen bg-background text-primary-text overflow-hidden font-sans">
      <Sidebar />

      {/* Settings Panel Content */}
      <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto space-y-8 relative">
        <div className="absolute top-[5%] right-[5%] w-96 h-96 rounded-full bg-accent-violet/5 blur-[120px] pointer-events-none animate-pulse-glow" />
        
        {/* Title Header */}
        <div className="border-b border-card-border pb-5 space-y-2">
          <h1 className="text-2xl font-medium tracking-tight flex items-center gap-3">
            <Shield className="text-accent-violet w-7 h-7" />
            API Credentials Management
          </h1>
          <p className="text-xs text-secondary-text">
            Configure your private keys. Credentials are encrypted on the server using AES-256 (Fernet) and never sent back to the client as raw text.
          </p>
        </div>

        {loadingSettings ? (
          <div className="h-64 flex flex-col items-center justify-center space-y-4">
            <Loader2 className="animate-spin text-accent-violet w-8 h-8" />
            <p className="text-xs text-muted-text italic">Reading configurations from secure database...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Loop through each available key provider */}
            {providers.map((p) => {
              const isConfigured = settings[`${p.id}_key_configured` as keyof SettingsResponse];
              const test = testResult[p.id];
              const isTesting = testing[p.id];

              return (
                <div
                  key={p.id}
                  className="p-5 rounded-xl border border-card-border bg-card-bg hover:border-accent-violet/25 transition-all duration-150 relative overflow-hidden"
                >
                  <div className="flex justify-between items-start gap-4 mb-3">
                    <div>
                      <h3 className="text-xs font-medium flex items-center gap-2">
                        {p.name}
                        {isConfigured && (
                          <span className="w-1.5 h-1.5 rounded-full bg-success-val indicator-pulse" />
                        )}
                      </h3>
                      <p className="text-[10px] text-secondary-text mt-0.5">{p.desc}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[8px] tracking-wider uppercase ${p.badgeColor}`}>
                      {p.badge}
                    </span>
                  </div>

                  <div className="flex gap-3 relative">
                    <div className="relative flex-1">
                      <input
                        type={showKeys[p.id] ? "text" : "password"}
                        value={keysInput[p.id]}
                        onChange={(e) => handleInputChange(p.id, e.target.value)}
                        placeholder={p.placeholder}
                        className="w-full text-xs p-2.5 pr-10 rounded-lg bg-muted-surface border border-card-border font-mono text-primary-text focus:ring-1 focus:ring-accent-violet focus:border-accent-violet focus:outline-none transition-colors duration-150"
                      />
                      <button
                        type="button"
                        onClick={() => toggleVisibility(p.id)}
                        className="absolute right-3.5 top-3 text-secondary-text hover:text-primary-text cursor-pointer transition-colors duration-150"
                        title={showKeys[p.id] ? "Hide Key" : "Reveal Key"}
                      >
                        {showKeys[p.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        handleTestKey(p.id);
                      }}
                      disabled={isTesting}
                      className="px-4 py-2.5 rounded-lg border border-card-border bg-muted-surface hover:bg-card-bg text-xs text-secondary-text hover:text-primary-text font-medium flex items-center gap-2 cursor-pointer transition-colors duration-150 disabled:opacity-40"
                    >
                      {isTesting ? (
                        <>
                          <Loader2 className="animate-spin w-3.5 h-3.5" />
                          Testing...
                        </>
                      ) : (
                        "Test Link"
                      )}
                    </button>
                  </div>

                  {/* Test Result Indicator Banner */}
                  {test && (
                    <div
                      className={`mt-3 p-3 rounded-lg flex items-start gap-2.5 text-xs animate-appear ${
                        test.success
                          ? "bg-success-val/10 text-success-val border border-success-val/20"
                          : "bg-error-val/10 text-error-val border border-error-val/20"
                      }`}
                    >
                      {test.success ? (
                        <CheckCircle size={15} className="shrink-0 mt-0.5" />
                      ) : (
                        <XCircle size={15} className="shrink-0 mt-0.5" />
                      )}
                      <div>
                        <p className="font-bold">{test.success ? "Authentication Succeeded" : "Connection Failed"}</p>
                        <p className="opacity-90 mt-0.5 text-[10px] leading-relaxed font-mono">{test.message}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Locked Premium Claude Card */}
            <div className="p-5 rounded-xl border border-warning-val/20 bg-gradient-to-r from-warning-val/5 to-warning-val/10 relative overflow-hidden group">
              <div className="absolute right-[-10px] bottom-[-10px] text-warning-val/5 rotate-12 pointer-events-none group-hover:scale-110 transition-all duration-150">
                <Lock size={120} />
              </div>
              <div className="flex justify-between items-start gap-4 mb-3">
                <div className="flex items-center gap-2">
                  <Lock className="text-warning-val w-3.5 h-3.5 animate-bounce" />
                  <h3 className="text-xs font-medium text-warning-val">Claude 3.5 Sonnet Integration</h3>
                </div>
                <span className="px-2 py-0.5 rounded-full border border-warning-val/30 bg-warning-val/10 text-warning-val text-[8px] font-medium uppercase tracking-widest flex items-center gap-1">
                  <Sparkles size={8} /> Premium Tier
                </span>
              </div>
              <p className="text-[10px] text-warning-val/80 leading-relaxed max-w-xl">
                Unlock the ultimate architecture design and complex reasoning capability. This locked credentials segment will activate in the paid upgrade path, enabling Claude models for complex programming.
              </p>
              <div className="mt-4 flex gap-3">
                <input
                  type="text"
                  placeholder="Premium Locked (sk-ant-xxx)"
                  disabled
                  className="flex-1 text-xs p-2.5 rounded-lg bg-warning-val/5 border border-warning-val/10 text-warning-val/40 cursor-not-allowed select-none"
                />
                <button
                  type="button"
                  disabled
                  className="px-4 py-2.5 rounded-lg border border-warning-val/10 bg-warning-val/5 text-warning-val/50 text-xs font-medium cursor-not-allowed"
                >
                  Configure Upgrade
                </button>
              </div>
            </div>

            {/* Account Deletion Area */}
            <div className="p-5 rounded-xl border border-red-500/25 bg-red-950/5 relative overflow-hidden">
              <div className="flex justify-between items-start gap-4 mb-3">
                <div>
                  <h3 className="text-xs font-semibold text-red-500 flex items-center gap-2">
                    Danger Zone: Permanent Account Deletion
                  </h3>
                  <p className="text-[10px] text-zinc-500 mt-1">
                    Permanently delete your profile, chats, memory graphs, and encrypted API keys. This action is irreversible.
                  </p>
                </div>
              </div>
              <div className="mt-4">
                {deleteConfirmOpen ? (
                  <div className="space-y-3">
                    <p className="text-[10px] text-zinc-400">
                      To confirm deletion, please type <span className="font-mono font-bold text-red-500">DELETE</span> in the box below:
                    </p>
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder="Type 'DELETE' to confirm"
                        className="flex-1 text-xs p-2.5 rounded-lg bg-red-950/10 border border-red-900/40 text-primary-text font-mono focus:outline-none focus:border-red-500 transition-colors duration-150"
                      />
                      <button
                        type="button"
                        onClick={handleDeleteAccount}
                        disabled={deleteConfirmText !== "DELETE" || isDeleting}
                        className="px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-red-900/40 disabled:text-red-700 text-white text-xs font-medium cursor-pointer transition-colors duration-150 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {isDeleting ? (
                          <>
                            <Loader2 className="animate-spin w-3.5 h-3.5" />
                            Deleting...
                          </>
                        ) : (
                          "Confirm Permanent Deletion"
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteConfirmOpen(false);
                          setDeleteConfirmText("");
                          setDeleteError(null);
                        }}
                        className="px-4 py-2.5 rounded-lg border border-card-border bg-muted-surface hover:bg-card-bg text-xs text-secondary-text cursor-pointer transition-colors duration-150"
                      >
                        Cancel
                      </button>
                    </div>
                    {deleteError && (
                      <p className="text-[10px] text-red-500 font-mono mt-1">Error: {deleteError}</p>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmOpen(true)}
                    className="px-4 py-2.5 rounded-lg border border-red-500/20 bg-red-950/20 hover:bg-red-950/40 text-red-400 text-xs font-semibold cursor-pointer transition-colors duration-150 shadow-sm"
                  >
                    Delete My OmniMind Account
                  </button>
                )}
              </div>
            </div>

            {/* Global Actions Bar */}
            <div className="flex items-center justify-between pt-4 border-t border-card-border">
              <div className="flex items-center gap-2 text-xs text-accent-violet">
                <Shield size={14} />
                <span className="font-mono text-[10px]">AES-256 Client-Server Cryptography Enabled</span>
              </div>

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    handleSaveSettings();
                  }}
                  disabled={saving}
                  className="px-5 py-2.5 rounded-lg bg-accent-violet hover:bg-accent-violet-hover text-white font-medium text-xs shadow-md transition-colors duration-150 flex items-center gap-2 disabled:opacity-55 cursor-pointer"
                >
                  {saving ? (
                    <>
                      <Loader2 className="animate-spin w-3.5 h-3.5" />
                      Encrypting & Saving...
                    </>
                  ) : (
                    "Save & Apply Configurations"
                  )}
                </button>
              </div>
            </div>

            {/* Save Message Notification Banner */}
            {saveMessage && (
              <div
                className={`p-4 rounded-lg flex items-start gap-3 text-xs animate-appear ${
                  saveMessage.success
                    ? "bg-success-val/10 text-success-val border border-success-val/20"
                    : "bg-error-val/10 text-error-val border border-error-val/20"
                }`}
              >
                {saveMessage.success ? <CheckCircle size={16} /> : <XCircle size={16} />}
                <div>
                  <p className="font-medium">{saveMessage.success ? "Successfully Applied" : "Configuration Update Terminated"}</p>
                  <p className="opacity-95 mt-0.5 text-[10px] leading-relaxed font-mono">{saveMessage.text}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
