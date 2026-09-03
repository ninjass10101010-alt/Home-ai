// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import Modal from "@/components/ui/Modal";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function mount(ui: React.ReactElement) {
  const container = document.createElement("div");
  container.className = "relative z-10";
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => { root!.render(ui); });
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  document.body.innerHTML = "";
});

describe("Modal portal + containment", () => {
  it("renders into document.body so CapsuleNav can never cover the footer", async () => {
    await mount(
      <Modal open onClose={() => {}} title="Add Task">
        <p>form</p>
      </Modal>
    );
    const container = document.querySelector(".relative")!;
    const heading = document.querySelector("h3");
    expect(heading?.textContent).toBe("Add Task");
    const overlay = heading?.closest(".fixed");
    expect(overlay).not.toBeNull();
    // The overlay must be a direct child of <body> (portaled), NOT inside the
    // page container — otherwise it inherits PageShell main's z-10 stacking
    // context and the z-50 capsule nav sits on top of the Save/Cancel footer.
    expect(overlay!.parentElement).toBe(document.body);
    expect(container.contains(overlay!)).toBe(false);
  });

  it("caps the panel height and scrolls so tall forms never run off-screen", async () => {
    await mount(
      <Modal open onClose={() => {}} title="Add Task" footer={<button>Save</button>}>
        <p>tall form</p>
      </Modal>
    );
    const panel = document.querySelector("h3")?.closest(".material-thick");
    expect(panel).not.toBeNull();
    expect(panel!.className).toContain("max-h-[85dvh]");
    // The body scrolls while the header + footer stay pinned, so Save/Cancel
    // are visible without scrolling on short phone viewports.
    expect(panel!.className).toContain("flex");
    expect(panel!.className).toContain("flex-col");
    expect(panel!.className).not.toContain("overflow-y-auto");
    const body = document.querySelector("h3")?.parentElement?.nextElementSibling;
    expect(body!.className).toContain("min-h-0");
    expect(body!.className).toContain("flex-1");
    expect(body!.className).toContain("overflow-y-auto");
    const footer = panel!.lastElementChild;
    expect(footer!.querySelector("button")?.textContent).toBe("Save");
  });
});
