import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.stubGlobal("fetch", h.fetchMock);

import { createShoppingListViaComposio } from "@/lib/instacart";

describe("createShoppingListViaComposio", () => {
  beforeEach(() => {
    h.fetchMock.mockReset();
  });

  it("calls Composio INSTACART_CREATE_SHOPPING_LIST_PAGE and returns URL (real v3.1 shape: data.url)", async () => {
    h.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { url: "https://customers.dev.instacart.tools/store/shopping_lists/12345" },
        successful: true,
      }),
    });

    const result = await createShoppingListViaComposio({
      apiKey: "ak_test_key",
      title: "Weekly Groceries — ALDI",
      items: [
        { name: "milk", quantity: 1, unit: "gallon" },
        { name: "eggs", quantity: 1, unit: "dozen" },
      ],
    });

    expect(result.url).toBe("https://customers.dev.instacart.tools/store/shopping_lists/12345");
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(h.fetchMock).toHaveBeenCalledWith(
      "https://backend.composio.dev/api/v3.1/tools/execute/INSTACART_CREATE_SHOPPING_LIST_PAGE",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-API-Key": "ak_test_key" }),
      }),
    );
  });

  it("still accepts the legacy result.output.shopping_list_url shape", async () => {
    h.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          output: {
            shopping_list_url: "https://customers.dev.instacart.tools/store/shopping_lists/legacy",
          },
        },
      }),
    });

    const result = await createShoppingListViaComposio({
      apiKey: "ak_test_key",
      title: "Test",
      items: [{ name: "milk" }],
    });
    expect(result.url).toBe("https://customers.dev.instacart.tools/store/shopping_lists/legacy");
  });

  it("throws a descriptive error when the response has no URL in any known shape", async () => {
    h.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { somethingElse: true } }),
    });

    await expect(
      createShoppingListViaComposio({
        apiKey: "ak_test_key",
        title: "Test",
        items: [{ name: "milk" }],
      }),
    ).rejects.toThrow(/no.*URL|did not return/i);
  });

  it("surfaces Composio's error message on failure (successful:false)", async () => {
    h.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: null, successful: false, error: { message: "tool unavailable" } }),
    });

    await expect(
      createShoppingListViaComposio({
        apiKey: "ak_test_key",
        title: "Test",
        items: [{ name: "milk" }],
      }),
    ).rejects.toThrow(/tool unavailable/i);
  });

  it("throws on non-ok response", async () => {
    h.fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "forbidden",
    });

    await expect(
      createShoppingListViaComposio({
        apiKey: "ak_test_key",
        title: "Test",
        items: [{ name: "milk" }],
      }),
    ).rejects.toThrow("Composio API error (403)");
  });
});
