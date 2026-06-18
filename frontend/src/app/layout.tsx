import "./globals.css";
import "katex/dist/katex.min.css";
import React from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "OmniMind — Multi-LLM Unified Chat Platform",
  description: "An intelligent chat platform with cognitive model routing, AES encryption, and Neo4j memory graph pipelines.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const theme = localStorage.getItem('omnimind_theme') || 'dark';
                if (theme === 'dark') {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              } catch (_) {}
            `,
          }}
        />
        <script src="https://accounts.google.com/gsi/client" async defer></script>
      </head>
      <body className="min-h-full bg-background text-primary-text font-sans transition-colors duration-200">
        {children}
      </body>
    </html>
  );
}

