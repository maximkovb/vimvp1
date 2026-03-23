// Route segment config must live in a server module — the page is "use client"
// so maxDuration would be silently ignored there.
export const maxDuration = 30;

export default function NewMarketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
