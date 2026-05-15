"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { X } from "lucide-react";

export type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string, variant?: ToastVariant) => void;
  hideToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = `toast-${++toastCounter}`;
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  const hideToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, hideToast }}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

interface ToastProps {
  toast: Toast;
  onClose: () => void;
}

function SingleToast({ toast, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => onClose(), 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const variantStyles = {
    success: "bg-nori-500/90 text-white border-nori-400",
    error: "bg-accent-rose/90 text-white border-accent-rose/50",
    info: "bg-surface-3 text-text-primary border-surface-4",
  };

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-sm shadow-lg animate-in slide-in-from-bottom-full ${variantStyles[toast.variant]}`}
      role="alert"
    >
      <span className="text-sm font-medium">{toast.message}</span>
      <button
        onClick={onClose}
        className="ml-auto -mr-1 p-1 rounded hover:bg-white/10 transition-colors"
        aria-label="Close"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function ToastContainer() {
  const { toasts, hideToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-full max-w-sm px-4">
      {toasts.map((toast) => (
        <SingleToast key={toast.id} toast={toast} onClose={() => hideToast(toast.id)} />
      ))}
    </div>
  );
}

interface StandaloneToastProps {
  message: string;
  variant?: ToastVariant;
  onClose?: () => void;
}

export function Toast({ message, variant = "info", onClose }: StandaloneToastProps) {
  useEffect(() => {
    if (!onClose) return;
    const timer = setTimeout(() => onClose(), 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const variantStyles = {
    success: "bg-nori-500/90 text-white border-nori-400",
    error: "bg-accent-rose/90 text-white border-accent-rose/50",
    info: "bg-surface-3 text-text-primary border-surface-4",
  };

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-sm shadow-lg ${variantStyles[variant]}`}
      role="alert"
    >
      <span className="text-sm font-medium">{message}</span>
      {onClose && (
        <button
          onClick={onClose}
          className="ml-auto -mr-1 p-1 rounded hover:bg-white/10 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}