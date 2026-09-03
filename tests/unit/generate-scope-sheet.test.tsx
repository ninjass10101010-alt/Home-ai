// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import GenerateScopeSheet from "@/components/meals/GenerateScopeSheet";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;

async function mount(props: any) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<GenerateScopeSheet {...props} />); });
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  document.body.innerHTML = "";
});

const text = () => document.body.textContent || "";

it("shows both options with slot counts", async () => {
  await mount({ open: true, dayName: "Wed", dayEmpty: 3, weekEmpty: 12, onDay: vi.fn(), onWeek: vi.fn(), onCancel: vi.fn() });
  expect(text()).toContain("Just Wednesday");
  expect(text()).toContain("Fills 3 empty slots on this day");
  expect(text()).toContain("Whole week");
  expect(text()).toContain("Fills 12 empty slots across Mon–Sun");
});

it("tapping an option calls its handler", async () => {
  const onDay = vi.fn(); const onWeek = vi.fn();
  await mount({ open: true, dayName: "Wed", dayEmpty: 3, weekEmpty: 12, onDay, onWeek, onCancel: vi.fn() });
  const buttons = [...document.querySelectorAll("button")];
  await act(async () => { buttons.find((b) => b.textContent?.includes("Just Wednesday"))!.click(); });
  expect(onDay).toHaveBeenCalledTimes(1);
  await act(async () => { buttons.find((b) => b.textContent?.includes("Whole week"))!.click(); });
  expect(onWeek).toHaveBeenCalledTimes(1);
});

it("full day disables the day option", async () => {
  const onDay = vi.fn();
  await mount({ open: true, dayName: "Wed", dayEmpty: 0, weekEmpty: 5, onDay, onWeek: vi.fn(), onCancel: vi.fn() });
  const dayBtn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("This day is already full"));
  expect(dayBtn).toBeTruthy();
  expect(dayBtn!.disabled).toBe(true);
});
