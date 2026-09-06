// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import SectionCard from "@/components/patterns/SectionCard";

function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el.firstChild as HTMLElement;
}

describe("SectionCard centered header", () => {
  it("routes the icon to the protruding WidgetCard slot and keeps a centered title when centeredHeader is set", () => {
    const card = render(
      <SectionCard title="Today's Events" description="3 today" icon="📅" compact centeredHeader>
        <p>body</p>
      </SectionCard>
    );
    // The icon lives in the protruding top-left slot (absolute, z-30, tone halo).
    const protrudingIcon = Array.from(card.querySelectorAll("div")).find(
      (d) => d.className.includes("absolute") && d.className.includes("z-30") && d.className.includes("pointer-events-none")
    );
    expect(protrudingIcon).toBeTruthy();
    expect(protrudingIcon?.textContent).toContain("📅");
    const h3 = Array.from(card.querySelectorAll("h3")).find((h) => h.textContent === "Today's Events");
    expect(h3?.className).toContain("text-sm");
    expect(card.querySelector("[class*='text-center']")).not.toBeNull();
  });

  it("keeps the default left-aligned header (pl-[72px] + protruding icon)", () => {
    const card = render(<SectionCard title="Add to Pantry" icon="➕"><p>body</p></SectionCard>);
    expect(card.querySelector("h3")?.textContent).toBe("Add to Pantry");
    // children[0] is the absolutely-positioned protruding icon layer;
    // children[1] is the header div with pl-[72px].
    const header = card.children[1] as HTMLElement;
    expect(header.className).toContain("pl-[72px]");
  });

  it("floats the action absolutely in the centered header", () => {
    const card = render(
      <SectionCard title="T" centeredHeader action={<a href="/x">See all →</a>}>
        <p>body</p>
      </SectionCard>
    );
    expect(card.querySelector("a")?.parentElement?.className).toContain("absolute");
  });

  it("gives the centered body flex-col flex-1 so footers pin and content can scroll", () => {
    const card = render(<SectionCard title="T" centeredHeader><p>body</p></SectionCard>);
    const body = Array.from(card.querySelectorAll("div")).find(
      (d) => d.className.includes("flex-1") && d.className.includes("flex-col")
    );
    expect(body).toBeTruthy();
    expect(body?.className).toContain("flex-1");
    expect(body?.className).toContain("flex-col");
  });

  it("defaults the title to h3 (zero behavior change for existing consumers)", () => {
    const card = render(<SectionCard title="Kitchen"><p>body</p></SectionCard>);
    expect(card.querySelector("h3")?.textContent).toBe("Kitchen");
    expect(card.querySelector("h2")).toBeNull();
  });

  it("headingLevel='h2' swaps only the tag — same classes, both header paths", () => {
    const plain = render(
      <SectionCard title="Appearance" description="d" compact headingLevel="h2"><p>body</p></SectionCard>
    );
    const h2 = plain.querySelector("h2");
    expect(h2?.textContent).toBe("Appearance");
    expect(h2?.className).toContain("font-bold");
    expect(h2?.className).toContain("text-sm"); // compact sizing preserved
    expect(h2?.className).toContain("text-text-primary");
    expect(plain.querySelector("h3")).toBeNull();

    const centered = render(
      <SectionCard title="Today" centeredHeader headingLevel="h2"><p>body</p></SectionCard>
    );
    const ch2 = centered.querySelector("h2");
    expect(ch2?.textContent).toBe("Today");
    expect(ch2?.className).toContain("text-base"); // non-compact sizing preserved
    expect(centered.querySelector("h3")).toBeNull();
  });
});
