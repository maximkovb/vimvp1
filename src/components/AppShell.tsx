import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { SidebarClient } from "./SidebarClient";
import { BottomNavClient } from "./BottomNavClient";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const admin = isAdmin(session);

  let initialBalance: number | null = null;
  if (session?.user?.id) {
    const [user] = await db
      .select({ balance: users.balance })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    if (user) initialBalance = parseFloat(user.balance);
  }

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 fixed top-0 left-0 h-screen border-r border-border bg-card z-40">
        <SidebarClient
          session={session}
          initialBalance={initialBalance}
          isAdmin={admin}
        />
      </aside>

      {/* Main content — offset by sidebar on desktop, full-width on mobile */}
      <div className="flex-1 md:ml-56 flex flex-col min-h-screen">
        <main className="flex-1 pb-16 md:pb-0">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <BottomNavClient />
      </nav>
    </div>
  );
}
