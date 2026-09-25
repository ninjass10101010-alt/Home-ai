// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import FormField from "@/components/patterns/FormField";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(field: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(field));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
});

describe("FormField id wiring", () => {
  it("keeps the legacy label and message markup unchanged when ids are omitted", () => {
    const element = render(
      <FormField label="Name" helperText="Helper">
        <input />
      </FormField>,
    );
    const label = element.querySelector("label")!;
    const message = element.querySelectorAll("span")[1];
    expect(label.hasAttribute("for")).toBe(false);
    expect(message.hasAttribute("id")).toBe(false);
  });

  it("wires label, helper, and active error ids without changing existing consumers", () => {
    const element = render(
      <FormField
        label="Name"
        controlId="member-name"
        helperId="member-name-helper"
        errorId="member-name-error"
        helperText="Enter a name"
      >
        <input id="member-name" />
      </FormField>,
    );
    expect(element.querySelector("label")!.getAttribute("for")).toBe("member-name");
    expect(element.querySelector("#member-name-helper")).not.toBeNull();

    act(() => root!.render(
      <FormField
        label="Name"
        controlId="member-name"
        helperId="member-name-helper"
        errorId="member-name-error"
        helperText="Enter a name"
        errorText="Name is required"
      >
        <input id="member-name" />
      </FormField>,
    ));
    expect(element.querySelector("#member-name-error")).not.toBeNull();
    expect(element.querySelector("#member-name-helper")).toBeNull();
  });
});
