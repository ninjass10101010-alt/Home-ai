// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import PhotoCropEditor from "@/components/profile/PhotoCropEditor";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom has no ResizeObserver; the editor measures its viewport with one.
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

describe("PhotoCropEditor portal", () => {
  it("renders into document.body so CapsuleNav can never cover Apply/Cancel", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(
        <PhotoCropEditor src="data:image/webp;base64,AAAA" onApply={() => {}} onCancel={() => {}} />
      );
    });
    const heading = document.querySelector("h3");
    expect(heading?.textContent).toBe("Reposition photo");
    // The overlay must be a direct child of <body> (portaled), NOT inside the
    // component container — otherwise it inherits the page's z-10 stacking
    // context and the z-50 capsule nav sits on top of the Apply button.
    const overlay = heading?.closest(".fixed");
    expect(overlay).not.toBeNull();
    expect(overlay!.parentElement).toBe(document.body);
    expect(container.contains(overlay!)).toBe(false);
  });
});
