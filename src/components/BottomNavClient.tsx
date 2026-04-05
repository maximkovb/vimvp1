"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav-items";

export function BottomNavClient() {
  const pathname = usePathname();

  return (
    <div className="flex items-center justify-around px-2 py-2">
      {NAV_ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-colors min-w-0 ${
              active ? "text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            {item.icon(22)}
            <span className="text-[10px] font-medium truncate">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
