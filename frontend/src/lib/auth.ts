import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

// Define interface for mocked User details
export interface MockUser {
  primaryEmailAddress?: {
    emailAddress: string;
  };
  fullName?: string;
  firstName?: string;
  username?: string;
  imageUrl?: string;
}

// Helper function to decode Google ID Token JWT payload on client side safely
export function parseJwt(token: string) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error("Failed parsing JWT token:", e);
    return null;
  }
}

export function useUser() {
  const [user, setUser] = useState<MockUser | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("omnimind_google_token");
      if (token) {
        if (token.startsWith("guest_")) {
          setUser({
            primaryEmailAddress: { emailAddress: `${token}@guest.omnimind.ai` },
            fullName: "Guest User",
            firstName: "Guest",
            username: token,
            imageUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&h=100&q=80",
          });
          setIsSignedIn(true);
        } else {
          const payload = parseJwt(token);
          if (payload) {
            setUser({
              primaryEmailAddress: { emailAddress: payload.email || "" },
              fullName: payload.name || "OmniUser",
              firstName: payload.given_name || payload.name?.split(" ")[0] || "Omni",
              username: payload.email?.split("@")[0] || "omniuser",
              imageUrl: payload.picture || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&h=100&q=80",
            });
            setIsSignedIn(true);
          } else {
            // Token is invalid/corrupt, clean up
            localStorage.removeItem("omnimind_google_token");
            document.cookie = "omnimind_token=; path=/; max-age=0; SameSite=Lax";
          }
        }
      }
      setIsLoaded(true);
    }
  }, []);

  return { isLoaded, isSignedIn, user };
}

export function useClerk() {
  const router = useRouter();

  const signOut = async () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("omnimind_google_token");
      document.cookie = "omnimind_token=; path=/; max-age=0; SameSite=Lax";
    }
    router.push("/auth");
  };

  const openSignIn = () => {
    router.push("/auth");
  };

  return { openSignIn, signOut };
}

export function useAuth() {
  const { isLoaded, isSignedIn } = useUser();
  return { isLoaded, isSignedIn, userId: isSignedIn ? "google_user" : null };
}
