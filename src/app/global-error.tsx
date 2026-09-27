"use client";

/**
 * Last-resort boundary for when the *root layout itself* fails (audit P0-4,
 * phase 2). Next replaces the whole tree — including `<html>`/`<body>` and every
 * provider — so this file may not import anything that needs them: no `PageShell`,
 * no `ErrorState`, no CSS variables (globals.css is imported by the layout that
 * just failed). Hence the inline styles and the raw `<!DOCTYPE html>` shape.
 *
 * Text stays at 14px+ by hand for the same reason (Contract B2's 12px floor,
 * `docs/UI_AUDIT_2026-09.md`): nothing is loading the design system here.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#0f1117",
          color: "#f3f4f6",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          boxSizing: "border-box",
        }}
      >
        <div
          role="alert"
          data-testid="global-error"
          style={{
            maxWidth: "26rem",
            width: "100%",
            textAlign: "center",
            border: "1px solid rgba(251,113,133,0.35)",
            background: "rgba(251,113,133,0.10)",
            borderRadius: "24px",
            padding: "32px 24px",
          }}
        >
          <div style={{ fontSize: "36px", marginBottom: "12px" }} aria-hidden="true">
            ⚠️
          </div>
          <h1 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>
            Consuela could not start up
          </h1>
          <p style={{ fontSize: "14px", lineHeight: "22px", margin: "12px 0 0", color: "#cbd5e1" }}>
            The whole screen failed to load, not just one section. Reloading usually fixes it. If it
            does not, the family data on the NAS is safe.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: "20px",
              minHeight: "44px",
              padding: "0 20px",
              borderRadius: "16px",
              border: "none",
              background: "#e05a76",
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p style={{ fontSize: "13px", lineHeight: "20px", margin: "14px 0 0", color: "#94a3b8" }}>
              If this keeps happening, tell Consuela this code:{" "}
              <code style={{ fontFamily: "ui-monospace, monospace" }}>{error.digest}</code>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
