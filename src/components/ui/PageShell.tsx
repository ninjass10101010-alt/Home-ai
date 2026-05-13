"use client";

import { motion } from "framer-motion";
import BottomNav from "./BottomNav";

interface PageShellProps {
  children: React.ReactNode;
  className?: string;
}

export default function PageShell({ children, className = "" }: PageShellProps) {
  return (
    <div className="min-h-screen max-w-lg mx-auto relative">
      {/* Global Background Gradient Orbs - Maximum visibility and more centered/dashboard presence */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            x: [0, 20, 0],
            y: [0, 30, 0],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className="gradient-orb w-[500px] h-[500px] -top-32 -right-32 opacity-70"
          style={{ background: "radial-gradient(circle, rgba(167, 139, 250, 0.4), transparent 80%)" }}
        />
        <motion.div
          animate={{
            scale: [1.2, 1, 1.2],
            x: [0, -40, 0],
            y: [0, -20, 0],
          }}
          transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
          className="gradient-orb w-[600px] h-[600px] top-1/4 -left-48 opacity-60"
          style={{ background: "radial-gradient(circle, rgba(244, 114, 182, 0.35), transparent 80%)" }}
        />
        <motion.div
          animate={{
            scale: [1, 1.3, 1],
            rotate: [0, 90, 0],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="gradient-orb w-[450px] h-[450px] bottom-0 -right-20 opacity-50"
          style={{ background: "radial-gradient(circle, rgba(52, 211, 153, 0.3), transparent 80%)" }}
        />
      </div>

      <main className={`relative z-10 pb-28 ${className}`}>{children}</main>
      <BottomNav />
    </div>
  );
}
