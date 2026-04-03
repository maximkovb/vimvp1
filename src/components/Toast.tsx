"use client";

interface ToastProps {
  show: boolean;
  message: string;
  onDismiss: () => void;
}

/**
 * Minimal fixed-position toast component. No third-party dependencies.
 * Auto-dismissal is managed by the `useToast` hook; this component only
 * handles rendering and manual dismiss on click.
 */
export function Toast({ show, message, onDismiss }: ToastProps) {
  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={onDismiss}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 cursor-pointer"
    >
      <div className="flex items-center gap-3 px-5 py-3 bg-amber-500 text-white rounded-xl shadow-lg text-sm font-medium animate-in slide-in-from-bottom-4 fade-in duration-200">
        <span className="text-base">⏱</span>
        <span>{message}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="ml-2 opacity-70 hover:opacity-100 transition-opacity text-xs"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
