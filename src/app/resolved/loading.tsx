export default function Loading() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="h-8 w-48 bg-muted/30 rounded mb-6 animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-muted/20 animate-pulse">
            <div className="aspect-video rounded-t-xl bg-muted/30" />
            <div className="p-2 space-y-2">
              <div className="h-3 bg-muted/30 rounded w-3/4" />
              <div className="h-3 bg-muted/30 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
