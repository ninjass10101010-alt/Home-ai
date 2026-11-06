import { museToolCatalog } from "./execute";

export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    description: string;
    version: string;
  };
  servers: Array<{
    url: string;
    description: string;
  }>;
  security: Array<Record<string, string[]>>;
  paths: Record<string, any>;
  components: {
    securitySchemes: Record<string, any>;
  };
}

/**
 * Generate a valid OpenAPI 3.0.3 specification for the Consuela MUSE API.
 *
 * Each tool from the catalog is mapped to its dedicated individual path
 * `/api/muse/tool/{name}`, with its parameter schema placed directly in the
 * request body.
 */
export function generateMuseOpenApi(
  serverUrl: string,
  options?: { admin?: boolean }
): OpenApiSpec {
  const admin = options?.admin ?? false;
  const tools = museToolCatalog(admin);

  const paths: Record<string, any> = {
    "/api/muse/auth/login": {
      post: {
        operationId: "login",
        summary: "Exchange long-lived key for an expiring 6-month Bearer token",
        description: "Submit the operator-minted MUSE key to receive a stateless 6-month (180-day) Bearer token.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["key"],
                properties: {
                  key: {
                    type: "string",
                    description: "MUSE secret key minted in Settings -> MUSE API",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Successful login with bearer token",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    token: { type: "string" },
                    expiresAt: { type: "string" },
                    scopes: { type: "array", items: { type: "string" } },
                    admin: { type: "boolean" },
                  },
                },
              },
            },
          },
          "401": { description: "Invalid key" },
        },
      },
    },
    "/api/muse/whoami": {
      get: {
        operationId: "whoami",
        summary: "Check current MUSE token status and permissions",
        description: "Introspects the calling bearer token and reports active capabilities and expiration.",
        responses: {
          "200": {
            description: "Token metadata",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    enabled: { type: "boolean" },
                    admin: { type: "boolean" },
                    scopes: { type: "array", items: { type: "string" } },
                    expiresAt: { type: "string" },
                  },
                },
              },
            },
          },
          "401": { description: "Missing or invalid token" },
        },
      },
    },
    "/api/muse/context": {
      get: {
        operationId: "get_family_context",
        summary: "Get live snapshot of the family dashboard state",
        description:
          "Returns live calendar, members, pending tasks, meals, weather, and a pre-composed assistant context prompt.",
        parameters: [
          {
            name: "scope",
            in: "query",
            required: false,
            description: "Scope of the context pack (all, meal, task, schedule)",
            schema: {
              type: "string",
              enum: ["all", "meal", "task", "schedule"],
              default: "all",
            },
          },
        ],
        responses: {
          "200": {
            description: "Family context snapshot and prompt",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    scope: { type: "string" },
                    prompt: { type: "string" },
                    pack: { type: "object" },
                  },
                },
              },
            },
          },
          "401": { description: "Missing or invalid token" },
        },
      },
    },
  };

  // Add individual tool routes
  for (const tool of tools) {
    const name = tool.function.name;
    const desc = tool.function.description || name;
    const params = tool.function.parameters || { type: "object", properties: {} };
    const hasRequired = Array.isArray(params.required) && params.required.length > 0;

    paths[`/api/muse/tool/${name}`] = {
      post: {
        operationId: name,
        summary: desc.length > 120 ? desc.slice(0, 117) + "..." : desc,
        description: desc,
        requestBody: {
          required: hasRequired,
          content: {
            "application/json": {
              schema: params,
            },
          },
        },
        responses: {
          "200": {
            description: "Tool execution result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    result: { type: "object" },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid arguments" },
          "401": { description: "Missing or invalid token" },
          "403": { description: "Tool not allowed" },
        },
      },
    };
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Consuela Family Dashboard - MUSE Inbound API",
      description:
        "OpenAPI specification for the Consuela dashboard MUSE API. Provides family context, chores, calendar, meals, weather, and smart home control.",
      version: "1.0.0",
    },
    servers: [
      {
        url: serverUrl.replace(/\/+$/, ""),
        description: "Consuela Dashboard Server",
      },
    ],
    security: [
      {
        bearerAuth: [],
      },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "MUSE Bearer Token obtained from POST /api/muse/auth/login",
        },
      },
    },
  };
}
