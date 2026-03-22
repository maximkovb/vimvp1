export default function LeaderboardLoading() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="h-8 w-40 bg-card rounded-lg animate-pulse mb-6" />
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 bg-background rounded animate-pulse" />
        ))}
      </div>
    </div>
  );
}
