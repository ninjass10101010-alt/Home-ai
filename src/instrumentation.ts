export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startHABridge } = await import("./lib/ha/bridge");
    startHABridge();
  }
}
