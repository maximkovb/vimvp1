export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <div className="h-12 w-96 bg-card rounded-lg animate-pulse mx-auto mb-4" />
        <div className="h-6 w-64 bg-card rounded-lg animate-pulse mx-auto" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-card border border-border rounded-xl overflow-hidden"
          >
            <div className="aspect-video bg-background animate-pulse" />
            <div className="p-4 space-y-3">
              <div className="h-4 w-20 bg-background rounded animate-pulse" />
              <div className="h-5 w-full bg-background rounded animate-pulse" />
              <div className="h-8 w-full bg-background rounded-lg animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
