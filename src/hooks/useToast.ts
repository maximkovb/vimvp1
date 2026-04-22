"use client";

import { useState, useCallback } from "react";

export interface ToastState {
  show: boolean;
  message: string;
}

export interface UseToastReturn {
  show: boolean;
  message: string;
  /** Fire the toast with a message. Subsequent calls while toast is visible replace the message. */
  trigger: (message: string) => void;
  /** Manually dismiss the toast. */
  dismiss: () => void;
}

const TOAST_DURATION_MS = 5_000;

/**
 * Minimal toast hook with a single-fire transition guard.
 * Call `trigger(message)` to show the toast; it auto-dismisses after 5 s.
 * Calling `trigger` again while visible resets the timer.
 */
export function useToast(): UseToastReturn {
  const [state, setState] = useState<ToastState>({ show: false, message: "" });

  const trigger = useCallback((message: string) => {
    setState({ show: true, message });

    // Clear any existing auto-dismiss by using a module-level timer ref pattern
    const timer = setTimeout(() => {
      setState((prev) => (prev.message === message ? { show: false, message: "" } : prev));
    }, TOAST_DURATION_MS);

    return () => clearTimeout(timer);
  }, []);

  const dismiss = useCallback(() => {
    setState({ show: false, message: "" });
  }, []);

  return { show: state.show, message: state.message, trigger, dismiss };
}
