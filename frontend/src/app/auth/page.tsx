"use client";

import React, { useState, useEffect } from "react";
import { useUser, useClerk } from "@/lib/auth";
import { useRouter } from "next/navigation";
import NeuralNetworkCanvas from "@/components/NeuralNetworkCanvas";
import TypewriterFeatures from "@/components/ui/TypewriterFeatures";
import { Cpu, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export default function AuthPage() {
  const router = useRouter();
  const { signOut } = useClerk();
  const { isSignedIn, isLoaded } = useUser();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isEmailExpanded, setIsEmailExpanded] = useState(false);
  const [isCanvasAwake, setIsCanvasAwake] = useState(false);

  // If a user is already signed in, redirect them to the homepage immediately
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      router.replace("/");
    }
  }, [isLoaded, isSignedIn, router]);

  useEffect(() => {
    const timer = setTimeout(() => setIsCanvasAwake(true), 200);
    return () => clearTimeout(timer);
  }, []);

  // Initialize and Render Google Sign-in button
  useEffect(() => {
    const initGoogleGSI = () => {
      if (typeof window !== "undefined" && (window as any).google?.accounts?.id) {
        (window as any).google.accounts.id.initialize({
          client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "612756844403-t9vaaqvnh6effranaetf5lq1fpfsjj0j.apps.googleusercontent.com",
          callback: handleCredentialResponse,
        });

        const btnContainer = document.getElementById("google-signin-btn");
        if (btnContainer) {
          (window as any).google.accounts.id.renderButton(btnContainer, {
            theme: "dark",
            size: "large",
            width: btnContainer.clientWidth || 340,
            shape: "pill",
          });
        }
      }
    };

    initGoogleGSI();

    const interval = setInterval(() => {
      if ((window as any).google?.accounts?.id) {
        initGoogleGSI();
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, []);

  const handleCredentialResponse = async (response: any) => {
    const token = response.credential;
    if (!token) return;

    try {
      setLoading(true);
      setError("");

      // Decode JWT token on the client side safely
      const base64Url = token.split(".")[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
      const payload = JSON.parse(jsonPayload);

      // Save token in cookie and localStorage
      localStorage.setItem("omnimind_google_token", token);
      document.cookie = `omnimind_token=${token}; path=/; max-age=604800; SameSite=Lax`;

      // Call backend init user
      await api.initUser({
        email: payload.email,
        display_name: payload.name,
        avatar_url: payload.picture,
      });

      // Redirect to home
      router.push("/");
    } catch (err: any) {
      console.error("Failed Google Sign-In:", err);
      setError(err.message || "Failed to authenticate with Google.");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Mock email login by creating a client-side mock JWT
      const mockPayload = {
        email: email.trim(),
        name: fullName.trim() || email.split("@")[0],
        picture: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&h=100&q=80",
        given_name: fullName.split(" ")[0] || email.split("@")[0],
      };

      // Create a mock base64 token payload
      const mockToken = "mock_jwt_header." + btoa(JSON.stringify(mockPayload)) + ".mock_jwt_signature";

      localStorage.setItem("omnimind_google_token", mockToken);
      document.cookie = `omnimind_token=${mockToken}; path=/; max-age=604800; SameSite=Lax`;

      // Call backend init user
      await api.initUser({
        email: mockPayload.email,
        display_name: mockPayload.name,
        avatar_url: mockPayload.picture,
      });

      router.push("/");
    } catch (err: any) {
      setError(err.message || "Email authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-background transition-colors duration-200 overflow-hidden">
      <div className="w-full md:w-1/2 h-full flex flex-col justify-center px-8 sm:px-16 lg:px-24">
        <div className="w-full max-w-sm mx-auto space-y-6 text-center">
          <div className="flex flex-col items-center">
            <Cpu className="w-10 h-10 text-white" />
            <h1 className="text-[28px] font-light text-white mt-4 tracking-tight">OmniMind</h1>
            <p className="text-sm text-zinc-400 mt-1">Sign in to continue</p>
          </div>

          {/* Google Sign-in Official GSI Button Container */}
          <div className="w-full py-1 flex flex-col gap-3 justify-center items-center">
            <div id="google-signin-btn" className="w-full min-h-[44px]" />
            <button
              onClick={() => {
                const guestToken = "guest_" + Math.random().toString(36).substring(2, 15);
                localStorage.setItem("omnimind_google_token", guestToken);
                document.cookie = `omnimind_token=${guestToken}; path=/; max-age=604800; SameSite=Lax`;
                window.location.reload();
              }}
              className="w-full py-3 rounded-full bg-[#1e2030] border border-white/10 text-zinc-300 text-sm font-normal hover:border-white/20 hover:text-white transition-all duration-150 cursor-pointer shadow-lg active:scale-95 flex items-center justify-center gap-2"
            >
              Continue to Sandbox (Guest Mode)
            </button>
          </div>

          <div className="border-t border-white/8 pt-4">
            <button
              onClick={() => setIsEmailExpanded(!isEmailExpanded)}
              className="w-full text-center text-zinc-400 hover:text-zinc-200 text-sm py-2 transition-colors duration-150 cursor-pointer"
            >
              Continue with Email/Sandbox {isEmailExpanded ? "▲" : "▼"}
            </button>

            {isEmailExpanded && (
              <form onSubmit={handleEmailSubmit} className="space-y-3 mt-3 text-left animate-appear">
                {isSignUp && (
                  <input
                    type="text"
                    placeholder="Full Name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    className="w-full px-4 py-3 rounded-full bg-[#1e2030] border border-white/8 text-primary-text text-sm focus:outline-none focus:ring-1 focus:ring-[#4f8ef7] transition-all"
                  />
                )}
                <input
                  type="email"
                  placeholder="Email Address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-full bg-[#1e2030] border border-white/8 text-primary-text text-sm focus:outline-none focus:ring-1 focus:ring-[#4f8ef7] transition-all"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-full bg-[#1e2030] border border-white/8 text-primary-text text-sm focus:outline-none focus:ring-1 focus:ring-[#4f8ef7] transition-all"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-full bg-[#4f8ef7] hover:bg-[#3b7ee6] text-white text-sm font-normal transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <Loader2 className="animate-spin w-4 h-4" />
                  ) : isSignUp ? (
                    "Create Account"
                  ) : (
                    "Sign In"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsSignUp(!isSignUp)}
                  className="w-full text-center text-zinc-400 hover:text-zinc-200 text-xs py-1 transition-colors cursor-pointer"
                >
                  {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
                </button>
              </form>
            )}
          </div>

          {error && <p className="text-red-400 text-xs text-center">{error}</p>}
        </div>
      </div>

      {/* Right panel — 3D canvas + typewriter feature strip */}
      <div className="hidden md:flex md:flex-col w-1/2 h-full bg-background transition-colors duration-200 relative overflow-visible">
        <div className="relative flex-1 min-h-0 overflow-visible">
          <div className="absolute inset-0 pointer-events-none">
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-3xl"
              style={{
                background: "radial-gradient(circle, rgba(79, 142, 247, 0.08) 0%, rgba(124, 92, 252, 0.02) 50%, transparent 100%)",
              }}
            />
          </div>
          <div
            className="relative z-10 w-full h-full"
            style={{
              opacity: isCanvasAwake ? 0.35 : 0,
              transform: `${isCanvasAwake ? "scale(0.8)" : "scale(0.4)"} translateZ(0)`,
              transition: "opacity 1.8s ease-out, transform 1.8s ease-out",
              willChange: "opacity, transform",
            }}
          >
            <NeuralNetworkCanvas />
          </div>
        </div>

        <div className="relative z-20 min-h-[80px] pb-12 mt-8 overflow-visible">
          <TypewriterFeatures />
        </div>
      </div>
    </div>
  );
}
