"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

export default function ConsuelaFAB() {
  return (
    <Link
      href="/chat"
      className="fixed bottom-20 right-4 z-40 w-12 h-12 rounded-2xl bg-nori-500 text-white shadow-lg shadow-nori-500/30 flex items-center justify-center text-xl hover:bg-nori-400 tap consuela-glow"
      style={{
        boxShadow: "0 4px 20px rgba(59,130,246,0.35), 0 0 30px rgba(59,130,246,0.15)",
      }}
      aria-label="Ask Consuela"
    >
      ✨
    </Link>
  );
}
