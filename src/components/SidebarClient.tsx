"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BalanceChip } from "./BalanceChip";
import { UserMenu } from "./UserMenu";
import { NAV_ITEMS } from "@/lib/nav-items";
import type { Session } from "next-auth";

interface SidebarClientProps {
  session: Session | null;
  isAdmin: boolean;
}

export function SidebarClient({ session, isAdmin }: SidebarClientProps) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full p-4">
      {/* Logo */}
      <Link href="/" className="text-xl font-bold text-accent mb-8 block">
        Virality
      </Link>

      {/* Nav items */}
      <nav className="flex flex-col gap-1 flex-1">
        {NAV_ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:text-foreground hover:bg-card-hover"
              }`}
            >
              {item.icon(20)}
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section: balance + user + admin */}
      <div className="flex flex-col gap-3 pt-4 border-t border-border">
        {isAdmin && (
          <Link
            href="/admin/markets/new"
            className="flex items-center justify-center gap-2 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
          >
            <span>+</span>
            <span>Create Market</span>
          </Link>
        )}

        {session?.user ? (
          <>
            <BalanceChip />
            <UserMenu user={session.user} />
          </>
        ) : (
          <Link
            href="/auth/signin"
            className="flex items-center justify-center px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
          >
            Sign In
          </Link>
        )}
      </div>
    </div>
  );
}
