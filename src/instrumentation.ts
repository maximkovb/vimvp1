export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initPolling } = await import("./lib/instrumentation-polling");
    void initPolling(); // fire-and-forget — don't block server startup
  }
}
