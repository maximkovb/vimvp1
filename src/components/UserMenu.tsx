"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";

interface UserMenuProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

export function UserMenu({ user }: UserMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm hover:text-accent transition-colors"
      >
        <span className="hidden sm:inline">{user.name || user.email}</span>
        <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent font-medium">
          {(user.name || user.email || "U")[0].toUpperCase()}
        </div>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-48 bg-card border border-border rounded-lg shadow-lg z-50 py-1">
            <Link
              href="/profile"
              className="block px-4 py-2 text-sm text-muted hover:text-foreground hover:bg-card-hover"
              onClick={() => setOpen(false)}
            >
              Profile
            </Link>
            <Link
              href="/portfolio"
              className="block px-4 py-2 text-sm text-muted hover:text-foreground hover:bg-card-hover sm:hidden"
              onClick={() => setOpen(false)}
            >
              Portfolio
            </Link>
            <hr className="border-border my-1" />
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="block w-full text-left px-4 py-2 text-sm text-red hover:bg-card-hover"
            >
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
