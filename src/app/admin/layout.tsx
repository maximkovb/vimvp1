import { isAdmin } from "@/lib/admin";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!isAdmin(session)) redirect("/");

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center gap-4 mb-6 pb-4 border-b border-border">
        <h1 className="text-xl font-bold text-accent">Admin</h1>
        <nav className="flex gap-3 text-sm">
          <Link
            href="/admin/markets"
            className="text-muted hover:text-foreground transition-colors"
          >
            Markets
          </Link>
          <Link
            href="/admin/markets/new"
            className="text-muted hover:text-foreground transition-colors"
          >
            Create Market
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
