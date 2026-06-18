"use client";

import React, { useState, useEffect } from "react";

const FEATURES = [
  "Visualize your memories as an intelligent 3D knowledge graph",
  "Chat with your second brain — powered by AI",
  "Explore, connect, and rediscover everything you've ever saved",
];

export default function TypewriterFeatures() {
  const [currentText, setCurrentText] = useState("");
  const [index, setIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showCursor, setShowCursor] = useState(true);

  // Blinking cursor logic (simple | character blinking every 500ms)
  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 500);
    return () => clearInterval(cursorInterval);
  }, []);

  // Typewriter typing and deleting logic
  useEffect(() => {
    let timer: NodeJS.Timeout;
    const fullString = FEATURES[index];

    if (!isDeleting) {
      // Typing mode: 50ms speed per character
      if (currentText !== fullString) {
        timer = setTimeout(() => {
          setCurrentText(fullString.slice(0, currentText.length + 1));
        }, 50);
      } else {
        // Paused for 2000ms after fully typed
        timer = setTimeout(() => {
          setIsDeleting(true);
        }, 2000);
      }
    } else {
      // Deleting mode: 30ms speed per character
      if (currentText !== "") {
        timer = setTimeout(() => {
          setCurrentText(currentText.slice(0, -1));
        }, 30);
      } else {
        // Paused for 500ms before moving to the next feature string
        timer = setTimeout(() => {
          setIsDeleting(false);
          setIndex((prevIndex) => (prevIndex + 1) % FEATURES.length);
        }, 500);
      }
    }

    return () => clearTimeout(timer);
  }, [currentText, isDeleting, index]);

  return (
    <div className="flex flex-col items-center justify-center text-center px-4 w-full select-none">
      <span className="text-secondary-text text-sm mb-2 font-medium tracking-wide">
        What OmniMind can do
      </span>
      <div className="min-h-[80px] flex items-center justify-center text-lg md:text-xl font-medium text-primary-text max-w-md leading-relaxed">
        <span>{currentText}</span>
        <span
          className={`ml-0.5 text-violet-400 font-bold transition-opacity duration-100 ${
            showCursor ? "opacity-100" : "opacity-0"
          }`}
        >
          |
        </span>
      </div>
    </div>
  );
}
