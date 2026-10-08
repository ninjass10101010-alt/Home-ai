// @vitest-environment jsdom
/**
 * PhotoUploader + RAW — the browser pipeline.
 *
 * A RAW cannot be decoded by `createImageBitmap`, so the uploader must extract
 * the embedded JPEG preview and resize THAT for the wall; when there is no
 * preview it archives the original off the wall with honest copy instead of
 * shipping a broken tile. The resize + extractor seams are mocked so the test
 * pins the orchestration (which bytes go to the wall, whether `noWall` is set),
 * not the byte parsing — that lives in raw-preview.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  resizeForWall: vi.fn(),
  extractRawPreview: vi.fn(),
}));

vi.mock("@/lib/photos/resize", () => ({ resizeForWall: mocks.resizeForWall }));
vi.mock("@/lib/photos/raw-preview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/photos/raw-preview")>();
  return { ...actual, extractRawPreview: mocks.extractRawPreview };
});

import PhotoUploader from "@/components/photos/PhotoUploader";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => {
    root = createRoot(el);
    root.render(ui);
  });
  return el;
}

function makeFile(name: string, type = ""): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type, lastModified: 1700000000000 });
}

async function selectFiles(el: HTMLElement, files: File[]) {
  const input = el.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

/** Capture the FormData each upload posts. */
function stubFetch(bodies: FormData[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: FormData }) => {
      if (init?.body) bodies.push(init.body);
      return { ok: true, status: 201, json: async () => ({ ok: true }) };
    }),
  );
}

beforeEach(() => {
  mocks.resizeForWall.mockReset();
  mocks.extractRawPreview.mockReset();
  mocks.resizeForWall.mockResolvedValue({ blob: new Blob(["wall"]), width: 1600, height: 1200 });
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("PhotoUploader + RAW", () => {
  it("resizes the extracted RAW preview (not the RAW) and puts it on the wall", async () => {
    const preview = new Blob(["embedded-jpeg"]);
    mocks.extractRawPreview.mockResolvedValue(preview);
    const bodies: FormData[] = [];
    stubFetch(bodies);

    const el = render(<PhotoUploader />);
    await selectFiles(el, [makeFile("IMG_0001.dng")]);

    expect(mocks.extractRawPreview).toHaveBeenCalledTimes(1);
    expect(mocks.resizeForWall).toHaveBeenCalledWith(preview);
    expect(bodies[0].get("wall")).toBeTruthy();
    expect(bodies[0].get("noWall")).toBeNull();
    expect(el.querySelector("li")?.textContent).toContain("Added to the wall");
  });

  it("archives a preview-less RAW off the wall with honest copy", async () => {
    mocks.extractRawPreview.mockResolvedValue(null);
    const bodies: FormData[] = [];
    stubFetch(bodies);

    const el = render(<PhotoUploader />);
    await selectFiles(el, [makeFile("IMG_0002.dng")]);

    expect(bodies[0].get("wall")).toBeNull();
    expect(bodies[0].get("noWall")).toBe("true");
    expect(el.querySelector("li")?.textContent).toContain("no wall preview");
  });

  it("resizes an ordinary image directly, without the RAW extractor", async () => {
    const bodies: FormData[] = [];
    stubFetch(bodies);

    const el = render(<PhotoUploader />);
    await selectFiles(el, [makeFile("pic.jpg", "image/jpeg")]);

    expect(mocks.extractRawPreview).not.toHaveBeenCalled();
    expect(bodies[0].get("wall")).toBeTruthy();
    expect(bodies[0].get("noWall")).toBeNull();
  });
});
