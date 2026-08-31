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

  it("calls Composio INSTACART_CREATE_SHOPPING_LIST_PAGE and returns URL", async () => {
    h.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          output: {
            shopping_list_url: "https://customers.dev.instacart.tools/store/shopping_lists/12345",
          },
        },
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
