// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { usePendingChatQuery } from "@/hooks/usePendingChatQuery";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el.firstChild as HTMLElement;
}

function Harness({
  queryParam,
  hydrated,
  onQuery,
}: {
  queryParam: string | null;
  hydrated: boolean;
  onQuery: (q: string) => void;
}) {
  const { pendingQuery } = usePendingChatQuery(queryParam, hydrated, onQuery);
  return <div data-pending={pendingQuery ?? ""}>harness</div>;
}

describe("usePendingChatQuery", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/chat");
  });

  it("fires the query exactly once after hydration", () => {
    const onQuery = vi.fn();
    const root = document.createElement("div");
    document.body.appendChild(root);
    const reactRoot = createRoot(root);
    act(() => reactRoot.render(<Harness queryParam="What's running low?" hydrated={false} onQuery={onQuery} />));

    act(() => reactRoot.render(<Harness queryParam="What's running low?" hydrated={true} onQuery={onQuery} />));

    expect(onQuery).toHaveBeenCalledTimes(1);
    expect(onQuery).toHaveBeenCalledWith("What's running low?");
  });

  it("does not fire before hydration", () => {
    const onQuery = vi.fn();
    const root = document.createElement("div");
    document.body.appendChild(root);
    act(() => createRoot(root).render(<Harness queryParam="Any calendar conflicts?" hydrated={false} onQuery={onQuery} />));
    expect(onQuery).not.toHaveBeenCalled();
  });

  it("consumes the query — a second render with the same param does not re-fire", () => {
    const onQuery = vi.fn();
    const root = document.createElement("div");
    document.body.appendChild(root);
    const reactRoot = createRoot(root);
    act(() => reactRoot.render(<Harness queryParam="Any chores?" hydrated={true} onQuery={onQuery} />));
    // Simulate the URL being stripped: queryParam now null on re-render.
    act(() => reactRoot.render(<Harness queryParam={null} hydrated={true} onQuery={onQuery} />));
    act(() => reactRoot.render(<Harness queryParam="Any chores?" hydrated={true} onQuery={onQuery} />));
    expect(onQuery).toHaveBeenCalledTimes(1);
  });

  it("clears the pending query after firing", () => {
    const onQuery = vi.fn();
    const root = document.createElement("div");
    document.body.appendChild(root);
    const reactRoot = createRoot(root);
    act(() => reactRoot.render(<Harness queryParam="Test" hydrated={false} onQuery={onQuery} />));
    act(() => reactRoot.render(<Harness queryParam="Test" hydrated={true} onQuery={onQuery} />));
    const el = root.firstChild as HTMLElement;
    expect(el.getAttribute("data-pending")).toBe("");
  });
});