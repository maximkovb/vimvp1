export default function PortfolioLoading() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="h-8 w-32 bg-card rounded-lg animate-pulse mb-6" />
      <div className="h-16 bg-card border border-border rounded-xl animate-pulse mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-card border border-border rounded-xl p-4 h-20 animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
