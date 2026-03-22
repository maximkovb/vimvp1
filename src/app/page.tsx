import { auth } from "@/lib/auth";
import Link from "next/link";

export default async function HomePage() {
  const session = await auth();

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-bold mb-4">
          Predict YouTube&apos;s <span className="text-accent">Next Hit</span>
        </h1>
        <p className="text-lg text-muted max-w-2xl mx-auto">
          Bet virtual currency on whether YouTube videos will hit view and
          engagement milestones. Trade against other predictors and climb the
          leaderboard.
        </p>
        {!session?.user && (
          <Link
            href="/auth/signup"
            className="inline-block mt-6 px-6 py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors"
          >
            Get 1,000 Free Coins
          </Link>
        )}
      </div>

      <div className="text-center text-muted py-16 border border-border rounded-xl bg-card">
        <p className="text-lg">No active markets yet.</p>
        <p className="text-sm mt-2">
          Markets will appear here once an admin creates them.
        </p>
      </div>
    </div>
  );
}
