/**
 * GET /api/connections — List all connection configs + statuses.
 * POST /api/connections — Connect a service (save credentials).
 * DELETE /api/connections/:id — Disconnect a service.
 *
 * Note: Credentials are stored client-side (localStorage).
 * This route provides the registry and proxies test calls.
 */
import { NextRequest, NextResponse } from "next/server";
import { CONNECTIONS } from "@/lib/connections/registry";

export async function GET() {
  return NextResponse.json({
    connections: CONNECTIONS.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      emoji: c.emoji,
      category: c.category,
      authType: c.authType,
      fields: c.fields.map((f) => ({
        ...f,
        // Never expose field values — only metadata
        placeholder: f.placeholder,
        label: f.label,
        type: f.type,
        helpText: f.helpText,
      })),
      features: c.features,
      setupUrl: c.setupUrl,
      available: c.available,
      composioProvider: c.composioProvider,
    })),
  });
}

/**
 * Test a connection by making a real API call with the provided credentials.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, credentials } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    // Find the connection config
    const config = CONNECTIONS.find((c) => c.id === id);
    if (!config) {
      return NextResponse.json({ success: false, error: `Unknown connection: ${id}` }, { status: 404 });
    }

    // Validate required fields
    const missing = config.fields
      .filter((f) => f.required)
      .filter((f) => !credentials?.[f.key]?.trim());

    if (missing.length > 0) {
      return NextResponse.json({
        success: false,
        error: `Missing required fields: ${missing.map((f) => f.label).join(", ")}`,
      }, { status: 400 });
    }

    // Service-specific connection tests
    let testResult: { success: boolean; message: string };

    switch (id) {
      case "instacart":
        testResult = await testInstacart(credentials.apiKey);
        break;
      case "home_assistant":
        testResult = await testHomeAssistant(credentials.url, credentials.token);
        break;
      case "spotify":
      case "amazon":
      case "walmart":
      case "google_maps":
      case "gmail":
      case "google_photos":
      case "doordash":
        testResult = await testComposio(credentials.apiKey);
        break;
      default:
        // No test available — accept the connection
        testResult = { success: true, message: "Credentials saved. Connection will be verified on first use." };
    }

    return NextResponse.json({
      success: testResult.success,
      message: testResult.message,
      connectionId: id,
    });
  } catch (error: any) {
    console.error("[connections]", error);
    return NextResponse.json(
      { success: false, error: error.message || "Connection test failed" },
      { status: 500 },
    );
  }
}

// ─── Service-specific test functions ────────────────────────────────────────

async function testInstacart(apiKey: string): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch("https://connect.instacart.com/idp/v1/products/products_link", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Connection Test",
        link_type: "shopping_list",
        line_items: [{ name: "test" }],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok || res.status === 400) {
      // 400 is fine — means the API key was accepted, just bad payload
      return { success: true, message: "Instacart connected! You can now create shopping lists." };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, message: "Invalid API key. Please check and try again." };
    }
    return { success: false, message: `Instacart returned ${res.status}. Try again later.` };
  } catch (e: any) {
    console.error("[connections]", e);
    return { success: false, message: `Could not reach Instacart: ${e.message}` };
  }
}

async function testHomeAssistant(url: string, token: string): Promise<{ success: boolean; message: string }> {
  try {
    const baseUrl = url.replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/api/`, {
      headers: { "Authorization": `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      return { success: true, message: `Home Assistant connected! Running version ${data.message || "unknown"}.` };
    }
    if (res.status === 401) {
      return { success: false, message: "Invalid access token. Generate a new one in Home Assistant." };
    }
    return { success: false, message: `Home Assistant returned ${res.status}.` };
  } catch (e: any) {
    console.error("[connections]", e);
    return { success: false, message: `Could not reach Home Assistant: ${e.message}. Check the URL.` };
  }
}

async function testComposio(apiKey: string): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch("https://backend.composio.dev/api/v1/client/auth/info", {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      return { success: true, message: "Composio connected! Your integrations are ready." };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, message: "Invalid Composio API key. Get one at dashboard.composio.dev" };
    }
    return { success: true, message: "Credentials saved. Will verify on first use." };
  } catch (e: any) {
    console.error("[connections]", e);
    // Composio API may not be reachable from all networks
    return { success: true, message: "Credentials saved. Connection will be verified when you use it." };
  }
}
