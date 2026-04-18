"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// iOS Safari carries the zoom level from one client-side navigation to the next.
// Briefly clamping maximum-scale=1 forces it to snap back to initial-scale=1,
// then we restore the original viewport so the user can still pinch-zoom.
export function ViewportReset() {
  const pathname = usePathname();

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.content;
    meta.content = "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover";
    setTimeout(() => {
      meta.content = original;
    }, 0);
  }, [pathname]);

  return null;
}
