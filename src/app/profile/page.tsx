import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { signOut } from "@/lib/auth";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/signin");

  const [user] = await db
    .select({ balance: users.balance, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id!))
    .limit(1);

  const balance = user ? Math.round(parseFloat(user.balance)) : 0;

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-8">Profile</h1>

      {/* User info card */}
      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        {/* Avatar */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xl font-bold">
            {((user?.name || user?.email || "U")[0] ?? "U").toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-lg">{user?.name ?? "—"}</p>
            <p className="text-sm text-muted">{user?.email}</p>
          </div>
        </div>

        {/* Balance */}
        <div className="flex items-center justify-between py-4 border-t border-border">
          <span className="text-sm text-muted">Coin Balance</span>
          <span className="font-bold tabular-nums">{balance.toLocaleString()} coins</span>
        </div>
      </div>

      {/* Sign out */}
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="w-full py-3 rounded-xl border border-red text-red text-sm font-medium hover:bg-red/10 transition-colors"
        >
          Sign Out
        </button>
      </form>
    </div>
  );
}
