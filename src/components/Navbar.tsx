import Link from "next/link";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { UserMenu } from "./UserMenu";

export async function Navbar() {
  const session = await auth();
  const admin = isAdmin(session);

  return (
    <nav className="border-b border-border bg-card">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-xl font-bold text-accent">
            Virality
          </Link>
          <div className="hidden sm:flex items-center gap-4 text-sm">
            <Link
              href="/"
              className="text-muted hover:text-foreground transition-colors"
            >
              Markets
            </Link>
            {session?.user && (
              <>
                <Link
                  href="/portfolio"
                  className="text-muted hover:text-foreground transition-colors"
                >
                  Portfolio
                </Link>
                <Link
                  href="/leaderboard"
                  className="text-muted hover:text-foreground transition-colors"
                >
                  Leaderboard
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {admin && (
            <Link
              href="/admin/markets/new"
              className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
            >
              + Create Market
            </Link>
          )}
          {session?.user ? (
            <UserMenu user={session.user} />
          ) : (
            <Link
              href="/auth/signin"
              className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
