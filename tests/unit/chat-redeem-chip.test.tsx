// The reward-redemption confirm chip. Chat never spends points: a tool `status`
// frame carrying a `{tool:"redeem_reward"}` proposal grows a "Confirm with PIN"
// chip under the assistant bubble, and ONLY the PIN submitted through that chip
// POSTs /api/rewards/redeem — the canonical write path, NOT the planner's
// deliberately tighter ALLOWED_TOOLS surface.
//
// Three facts this suite pins, because all of them are money:
//   1. The PIN that confirms a redemption is the REWARD OWNER's. A parent PIN is
//      additionally required only above PARENT_APPROVAL_MIN_COST (100, strictly
//      greater), so a cheap reward must not ask the family to wait for a parent.
//   2. operationId is the idempotency key — the redeem route validates it first
//      and answers 409 `duplicate` on a replay, so a retry that minted a fresh
//      key would spend the points twice. The chip FREEZES it at mount, which is
//      why the list key must carry it (see the key contract below).
//   3. A shop price or a balance can arrive as a numeric STRING (PocketBase text
//      field), and the redeem route reads it with `Number(...)` anyway — so a
//      stringly-typed cost must not silently erase the chip the model promised.
// Harness copied from chat-points-chip.test.tsx (createRoot + act, URL-routing
// fetch stub, open-gated Modal mock, native-setter typePin).
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { readFileSync } from "fs";
import { resolve } from "path";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const streamMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/chat-stream", () => ({ streamConsuelaChat: (opts: any) => streamMock.fn(opts) }));

const kidStore = vi.hoisted(() => ({
  verifyPinRemote: vi.fn(),
  unreachableCopy: vi.fn(() => "Couldn't reach Consuela — check the connection and try again."),
}));
vi.mock("@/modes/kid/kid-store", () => ({
  verifyPinRemote: kidStore.verifyPinRemote,
  unreachableCopy: kidStore.unreachableCopy,
}));

const authMock = vi.hoisted(() => ({
  state: { currentUser: null as any, isLoggedIn: false },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authMock.state }));

const inputProps = vi.hoisted(() => ({ current: null as null | { onSendMessage: (t: string) => Promise<void> } }));
vi.mock("@/components/chat/UnifiedInput", () => ({
  UnifiedInput: (props: any) => {
    inputProps.current = props;
    return <textarea data-testid="composer" readOnly />;
  },
}));
vi.mock("@/components/ui/CapsuleNav", () => ({ default: () => null }));
vi.mock("@/components/ui/Avatar", () => ({ default: () => null }));
vi.mock("@/components/ui/SigmaImage", () => ({ default: () => null }));
vi.mock("@/components/3d", () => ({ Icon3D: () => null }));
// Modal gated on `open` so "no dialog before the chip is tapped" is assertable.
vi.mock("@/components/ui/Modal", () => ({
  default: ({ open, title, description, children, footer }: any) =>
    open ? (
      <div data-testid="pin-modal">
        {title && <h3>{title}</h3>}
        {description && <p data-testid="pin-modal-description">{description}</p>}
        {children}
        {footer}
      </div>
    ) : null,
}));
vi.mock("@/app/chat/FamilyBrief", () => ({ FamilyBrief: () => <div data-testid="family-brief-mock" /> }));
vi.mock("@/app/chat/OpenLoopChips", () => ({ OpenLoopChips: () => <div data-testid="open-loops-mock" /> }));
vi.mock("@/hooks/usePendingChatQuery", () => ({ usePendingChatQuery: () => {} }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/db", () => ({ db: { selectMembers: () => [] } }));

import ChatPage from "@/app/chat/page";
import RedeemRewardChip, { isRewardRedemptionProposal } from "@/components/chat/RedeemRewardChip";
import { __resetChatStoreForTests } from "@/lib/chat-store";

const PROPOSAL = {
  tool: "redeem_reward" as const,
  operationId: "proposal-op-redem-1",
  args: {
    member: "Emily G",
    rewardId: "7",
    reward: "Movie night",
    cost: 25,
    reason: "great week",
  },
};

/** PARENT_APPROVAL_MIN_COST on the redeem route — strictly greater than. */
const atCost = (cost: number | string) => ({ ...PROPOSAL, args: { ...PROPOSAL.args, cost } });

let activeRoot: ReturnType<typeof createRoot> | null = null;
function render(ui: ReactElement): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => { activeRoot = createRoot(el); activeRoot.render(ui); });
  return el;
}

const redeemCalls: Array<{ url: string; init: any }> = [];
function stubFetch(redemption: { status: number; body: unknown } | Array<{ status: number; body: unknown }>) {
  redeemCalls.length = 0;
  const queue = Array.isArray(redemption) ? [...redemption] : [redemption];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    const u = String(url);
    if (u.includes("/api/rewards/redeem")) {
      redeemCalls.push({ url: u, init });
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      return new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, messages: [] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }));
}

function lastBody(): any {
  return JSON.parse(redeemCalls[redeemCalls.length - 1].init.body);
}

/** React's controlled-input tracker ignores a plain `.value =`. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function typePin(el: HTMLElement, pin: string) {
  const input = el.querySelector('input[type="password"][data-testid="member-pin"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  typeInto(input, pin);
}

function typeParentPin(el: HTMLElement, pin: string) {
  const input = el.querySelector('input[data-testid="parent-pin"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  typeInto(input, pin);
}

function clickButton(el: HTMLElement | Document, label: string): boolean {
  const root: ParentNode = el;
  const btn = Array.from(root.querySelectorAll("button")).find(
    (b) => b.textContent?.includes(label),
  ) as HTMLButtonElement | undefined;
  if (!btn) return false;
  act(() => { btn.click(); });
  return true;
}

/** Every typed code, wherever it currently sits in the document. */
function typedCodesInDom(): string[] {
  return Array.from(document.querySelectorAll("input"))
    .map((i) => (i as HTMLInputElement).value)
    .filter((v) => v !== "");
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  __resetChatStoreForTests();
  inputProps.current = null;
  authMock.state = {
    currentUser: { name: "Rebecca G", role: "parent", emoji: "🐱", color: "rose" },
    isLoggedIn: true,
  };
  streamMock.fn.mockReset();
  kidStore.verifyPinRemote.mockReset();
  kidStore.verifyPinRemote.mockResolvedValue({ status: "ok", member: { name: "Emily G" } });
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })));
});
afterEach(() => {
  act(() => { activeRoot?.unmount(); });
  activeRoot = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("chat page — redemption-proposal chip wiring", () => {
  it("a status frame carrying a redeem_reward proposal renders the chip; nothing POSTs before a PIN lands", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    streamMock.fn.mockImplementation(async ({ onStatus, onToken }: any) => {
      onStatus("Preparing that redemption…", {
        label: "Preparing that redemption…",
        proposal: PROPOSAL,
      });
      onToken("Ask Emily to confirm this redemption with their PIN", "…with their PIN");
      return { content: "Ask Emily to confirm", streamed: true };
    });
    const el = render(<ChatPage />);
    await act(async () => { await inputProps.current!.onSendMessage("Emily wants movie night"); });

    expect(el.textContent).toContain("Confirm with PIN");
    expect(el.textContent).toContain("Movie night");
    expect(el.textContent).toContain("25 pts");
    // The redeem row is its own testid: the adjust row must stay findable on a
    // thread that carries both kinds of proposal.
    expect(el.querySelector('[data-testid="redeem-proposals"]')).not.toBeNull();
    expect(redeemCalls).toHaveLength(0);
  });

  it("the buffered (non-stream) path surfaces redemption proposals too", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    streamMock.fn.mockResolvedValue({
      content: "Ready for confirmation",
      streamed: false,
      proposals: [PROPOSAL],
    });
    const el = render(<ChatPage />);
    await act(async () => { await inputProps.current!.onSendMessage("Emily wants movie night"); });
    expect(el.textContent).toContain("Confirm with PIN");
    expect(redeemCalls).toHaveLength(0);
  });

  it("never tells a cheap reward to wait for a parent whose PIN is never consulted", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    const el = render(<RedeemRewardChip proposal={atCost(25)} actorName="Rebecca G" />);
    expect(clickButton(el, "Confirm with PIN")).toBe(true);
    const copy = el.querySelector('[data-testid="pin-modal-description"]')!.textContent!;
    expect(copy).toMatch(/Emily/);
    expect(copy).toMatch(/her|their/i);
    expect(copy).not.toMatch(/parent/i);
    expect(el.querySelector('input[data-testid="parent-name"]')).toBeNull();
    expect(el.querySelector('input[data-testid="parent-pin"]')).toBeNull();
  });

  it("an unknown/garbage proposal payload renders no chip", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    streamMock.fn.mockImplementation(async ({ onStatus, onToken }: any) => {
      onStatus("x", { label: "x", proposal: { tool: "remove_event", args: { title: "x" } } });
      onStatus("y", { label: "y" });
      onToken("ok", "ok");
      return { content: "ok", streamed: true };
    });
    const el = render(<ChatPage />);
    await act(async () => { await inputProps.current!.onSendMessage("hi"); });
    expect(el.textContent).not.toContain("Confirm with PIN");
  });

  it("a thread whose stored proposal has no operation id renders NO chip at all", async () => {
    const legacy = { tool: "redeem_reward", args: { ...PROPOSAL.args } };
    stubFetch({ status: 200, body: { ok: true } });
    streamMock.fn.mockResolvedValue({
      content: "Ready for confirmation",
      streamed: false,
      proposals: [legacy],
    });
    const el = render(<ChatPage />);
    await act(async () => { await inputProps.current!.onSendMessage("Emily wants movie night"); });

    expect(el.textContent).not.toContain("Confirm with PIN");
    expect(redeemCalls).toHaveLength(0);
  });
});

describe("RedeemRewardChip — a stringly-typed price must not erase the chip", () => {
  // The tool hands back the raw shop row (`reward.cost ?? reward.points ?? 0`),
  // and a PocketBase TEXT field arrives as a string. The redeem route reads the
  // same value with `Number(...)` and would happily charge it, so a chip that
  // refuses the string leaves the model promising a PIN confirmation that no one
  // can give — the exact regression this chip exists to prevent.
  const stringCost = atCost("25");

  it("the guard accepts a numeric string", () => {
    expect(isRewardRedemptionProposal(stringCost)).toBe(true);
  });

  it("the guard still refuses a cost that is not a number at all", () => {
    // `Number("")`, `Number(null)` and `Number([])` are all 0, and a reward
    // priced at 0 would be handed to the route as a free redemption — so an
    // empty string, null and a boolean stay rejected.
    expect(isRewardRedemptionProposal(atCost(""))).toBe(false);
    expect(isRewardRedemptionProposal(atCost("   "))).toBe(false);
    expect(isRewardRedemptionProposal(atCost(null as unknown as number))).toBe(false);
    expect(isRewardRedemptionProposal(atCost(true as unknown as number))).toBe(false);
    expect(isRewardRedemptionProposal(atCost("free"))).toBe(false);
    expect(isRewardRedemptionProposal(atCost(Number.NaN))).toBe(false);
  });

  it("a stringly-typed cost still renders the chip and quotes the number", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    streamMock.fn.mockResolvedValue({
      content: "Ready for confirmation",
      streamed: false,
      proposals: [stringCost],
    });
    const el = render(<ChatPage />);
    await act(async () => { await inputProps.current!.onSendMessage("Emily wants movie night"); });

    expect(el.textContent).toContain("Confirm with PIN");
    expect(el.textContent).toContain("25 pts");
  });

  it("a stringly-typed cost above the threshold still asks for a parent", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    streamMock.fn.mockResolvedValue({
      content: "Ready for confirmation",
      streamed: false,
      proposals: [atCost("150")],
    });
    const el = render(<ChatPage />);
    await act(async () => { await inputProps.current!.onSendMessage("Emily wants the big reward"); });

    expect(clickButton(el, "Confirm with PIN")).toBe(true);
    expect(el.querySelector('input[data-testid="parent-pin"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="pin-modal-description"]')!.textContent).toContain("150");
  });

  it("a stringly-typed cost above the threshold still withholds the parent at exactly 100", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    const el = render(<RedeemRewardChip proposal={atCost("100")} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    expect(el.querySelector('input[data-testid="parent-pin"]')).toBeNull();
  });

  it("a stringly-typed BALANCE in the route's weekData is printed, not swallowed", async () => {
    stubFetch({
      status: 200,
      body: { ok: true, applied: true, member: "Emily G", weekData: { points: { "Emily G": "25" } } },
    });
    const el = render(<RedeemRewardChip proposal={PROPOSAL} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();

    expect(document.body.textContent).toContain("25 pts");
    expect(el.textContent).toContain("Done ✓");
  });
});

describe("RedeemRewardChip — the redeem write contract", () => {
  it("POSTs the seven-field contract to /api/rewards/redeem", async () => {
    stubFetch({ status: 200, body: { ok: true, weekData: { points: { "Emily G": 25 } } } });
    const el = render(<RedeemRewardChip proposal={PROPOSAL} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    expect(clickButton(el, "Submit")).toBe(true);
    await settle();

    expect(redeemCalls).toHaveLength(1);
    const call = redeemCalls[0];
    expect(call.url).toContain("/api/rewards/redeem");
    expect(call.url).not.toContain("planner/apply");
    expect(JSON.parse(call.init.body)).toEqual({
      operationId: PROPOSAL.operationId,
      rewardId: "7",
      rewardName: "Movie night",
      memberName: "Emily G",
      pin: "1234",
      parentName: "",
      parentPin: "",
    });
  });

  it("verifies the REWARD OWNER's PIN client-side, not the signed-in actor's", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    const el = render(<RedeemRewardChip proposal={PROPOSAL} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();
    expect(kidStore.verifyPinRemote).toHaveBeenCalledWith("Emily G", "1234");
    expect(lastBody().memberName).toBe("Emily G");
  });

  it("reveals the parent name + PIN fields only ABOVE 100 pts, and sends them", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    const el = render(<RedeemRewardChip proposal={atCost(150)} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    const name = el.querySelector('input[data-testid="parent-name"]') as HTMLInputElement;
    expect(name).not.toBeNull();
    expect(el.querySelector('[data-testid="pin-modal-description"]')!.textContent).toMatch(/parent/i);
    typeInto(name, "Rebecca G");
    typeParentPin(el, "5678");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();

    expect(lastBody()).toMatchObject({ parentName: "Rebecca G", parentPin: "5678" });
  });

  it("asks for NO parent PIN at exactly 100 pts — the threshold is strictly greater", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    const el = render(<RedeemRewardChip proposal={atCost(100)} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    expect(el.querySelector('input[data-testid="parent-name"]')).toBeNull();
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();
    expect(lastBody()).toMatchObject({ parentName: "", parentPin: "" });
  });

  it("treats 409 / reason:duplicate as already redeemed, not a failure", async () => {
    stubFetch({ status: 409, body: { ok: false, reason: "duplicate", error: "already went through" } });
    const el = render(<RedeemRewardChip proposal={PROPOSAL} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();

    expect(redeemCalls).toHaveLength(1);
    expect(el.textContent).toContain("Done ✓");
    expect(document.body.textContent).toContain("Already redeemed ✓");
    expect(el.textContent).not.toContain("Confirm with PIN");
  });

  it("reuses one operationId across retries so a retry can't double-redeem", async () => {
    stubFetch([
      { status: 503, body: { ok: false, reason: "ledger_unavailable", error: "Points could not be updated just now." } },
      { status: 200, body: { ok: true } },
    ]);
    const el = render(<RedeemRewardChip proposal={PROPOSAL} actorName="Rebecca G" />);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      clickButton(el, "Confirm with PIN");
      typePin(el, "1234");
      clickButton(el, "Submit");
      await settle();
    }

    expect(redeemCalls).toHaveLength(2);
    expect(JSON.parse(redeemCalls[0].init.body).operationId).toBe(PROPOSAL.operationId);
    expect(JSON.parse(redeemCalls[1].init.body).operationId)
      .toBe(JSON.parse(redeemCalls[0].init.body).operationId);
    expect(el.textContent).toContain("Done ✓");
  });

  it("renders the new balance from the returned weekData, not a re-read", async () => {
    stubFetch({
      status: 200,
      body: { ok: true, applied: true, member: "Emily G", weekData: { points: { "Emily G": 25 } } },
    });
    const el = render(<RedeemRewardChip proposal={PROPOSAL} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();

    expect(document.body.textContent).toContain("25 pts");
    expect(el.textContent).toContain("Done ✓");
    // Nothing re-read the balance on the way there.
    const urls = (globalThis.fetch as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(urls.filter((u: string) => /points|leaderboard|week/i.test(u))).toEqual([]);
  });

  it("a missing parent approval is not reported as a wrong PIN", async () => {
    stubFetch({
      status: 401,
      body: { ok: false, reason: "parent_approval_required", error: "A parent has to approve this reward." },
    });
    const el = render(<RedeemRewardChip proposal={atCost(150)} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();

    expect(el.textContent).toContain("A parent has to approve this reward.");
    expect(el.textContent).not.toContain("Wrong PIN");
    expect(el.textContent).not.toContain("Done ✓");
  });

  it("surfaces insufficient honestly, naming the shortfall", async () => {
    stubFetch({
      status: 400,
      body: { ok: false, reason: "insufficient", error: "Emily needs 15 more pts for 🎁 Movie night" },
    });
    const el = render(<RedeemRewardChip proposal={PROPOSAL} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();

    expect(el.textContent).toContain("Emily needs 15 more pts for 🎁 Movie night");
    expect(el.textContent).not.toContain("Done ✓");
  });

  it("a parent_only refusal is surfaced, never swallowed", async () => {
    stubFetch({
      status: 403,
      body: { ok: false, reason: "parent_only", error: "Only a parent can approve this reward." },
    });
    const el = render(<RedeemRewardChip proposal={atCost(150)} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    const name = el.querySelector('input[data-testid="parent-name"]') as HTMLInputElement;
    typeInto(name, "Emily G");
    typeParentPin(el, "1234");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();

    expect(el.textContent).toContain("Only a parent can approve this reward.");
    expect(el.textContent).not.toContain("Done ✓");
  });

  it("a 202 (ledger wrote, snapshot not yet reconciled) shows the redemption WITHOUT the canonical balance", async () => {
    // The ledger wrote the deduction, but the snapshot the rest of the dashboard
    // reads has not caught up — so the ledger's number is real and the dashboard
    // is showing something else. Printing it next to the dashboard's own balance
    // shows the family two different numbers for the same child, so the honest
    // Done chip withholds the number until the two agree. A 200/202 that does
    // NOT say `reconciled: false` keeps the balance (see the test above).
    stubFetch({
      status: 202,
      body: {
        ok: true,
        applied: true,
        reconciled: false,
        member: "Emily G",
        weekData: { points: { "Emily G": 25 } },
      },
    });
    const el = render(<RedeemRewardChip proposal={PROPOSAL} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();

    expect(redeemCalls).toHaveLength(1);
    expect(el.textContent).toContain("Done ✓");
    expect(el.textContent).not.toContain("pts left");
    expect(document.body.textContent).toContain("Redeemed ✓");
    expect(document.body.textContent).not.toContain("25 pts left");
  });
});

describe("RedeemRewardChip — PIN modal behavior (mirrors AdjustPointsChip)", () => {
  it("closing the dialog clears BOTH typed codes — no PIN outlives it", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    const el = render(<RedeemRewardChip proposal={atCost(150)} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    typeParentPin(el, "5678");
    expect(typedCodesInDom()).toEqual(["1234", "5678"]);

    expect(clickButton(el, "Cancel")).toBe(true);
    expect(typedCodesInDom()).toEqual([]);

    clickButton(el, "Confirm with PIN");
    expect(
      (el.querySelector('input[data-testid="member-pin"]') as HTMLInputElement).value,
    ).toBe("");
    expect(
      (el.querySelector('input[data-testid="parent-pin"]') as HTMLInputElement).value,
    ).toBe("");
    expect(redeemCalls).toHaveLength(0);
  });

  it("wrong PIN re-prompts and never POSTs", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    kidStore.verifyPinRemote.mockResolvedValue({ status: "wrongPin" });
    const el = render(<RedeemRewardChip proposal={PROPOSAL} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "9999");
    clickButton(el, "Submit");
    await settle();

    expect(el.textContent).toContain("Wrong PIN");
    expect(redeemCalls).toHaveLength(0);
    expect(el.querySelector('[data-testid="pin-modal"]')).not.toBeNull();
    expect(typedCodesInDom()).toEqual([]);
  });

  it("unreachable verification surfaces the honest copy, not a fake success", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    kidStore.verifyPinRemote.mockResolvedValue({ status: "unreachable" });
    const el = render(<RedeemRewardChip proposal={PROPOSAL} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();

    expect(el.textContent).toContain("Couldn't reach Consuela");
    expect(redeemCalls).toHaveLength(0);
    expect(el.textContent).not.toContain("Done ✓");
  });

  it("a 401 from the redeem route re-prompts (the server says the PIN is wrong)", async () => {
    stubFetch({ status: 401, body: { ok: false, reason: "invalid_pin", error: "Invalid PIN" } });
    const el = render(<RedeemRewardChip proposal={PROPOSAL} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();

    expect(redeemCalls).toHaveLength(1);
    expect(el.textContent).toContain("Wrong PIN");
    expect(el.textContent).not.toContain("Done ✓");
    expect(typedCodesInDom()).toEqual([]);
  });

  it("a network throw surfaces the unreachable copy instead of a Done chip", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const el = render(<RedeemRewardChip proposal={PROPOSAL} actorName="Rebecca G" />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();

    expect(el.textContent).toContain("Couldn't reach Consuela");
    expect(el.textContent).not.toContain("Done ✓");
  });

  it("no actor (signed-out) → honest refusal instead of a POST", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    const el = render(<RedeemRewardChip proposal={PROPOSAL} actorName={null} />);
    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();

    expect(kidStore.verifyPinRemote).not.toHaveBeenCalled();
    expect(redeemCalls).toHaveLength(0);
    expect(el.textContent).toMatch(/sign in/i);
    expect(el.textContent).not.toContain("Done ✓");
  });

  it("an UN-KEYED proposal (a thread stored before operation ids existed) can never be submitted", async () => {
    const legacy = { tool: "redeem_reward", args: { ...PROPOSAL.args } } as any;
    stubFetch({ status: 200, body: { ok: true } });
    const el = render(<RedeemRewardChip proposal={legacy} actorName="Rebecca G" />);

    clickButton(el, "Confirm with PIN");
    typePin(el, "1234");
    clickButton(el, "Submit");
    await settle();

    expect(redeemCalls).toHaveLength(0);
    expect(kidStore.verifyPinRemote).not.toHaveBeenCalled();
    expect(el.textContent).toMatch(/fresh proposal/i);
    expect(el.textContent).not.toContain("Done ✓");
  });
});

describe("RedeemRewardChip — the two duplicated constants this money path cannot drift on", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, "../../", rel), "utf8");

  it("the chip's parent-approval threshold is the redeem route's threshold", () => {
    // Both files must carry the SAME literal. Drift is bounded but real: down
    // means the chip asks for a grown-up the route never required; up means the
    // chip skips a field the route demands and the family eats an honest 401.
    // Neither is Critical, and both are silent — so the literal is pinned here
    // instead of extracted into a shared module (which would mean editing the
    // route, outside this fix's file set). A deliberate threshold change fails
    // here, which is the point: it has to be a decision, not a drift.
    expect(read("src/app/api/rewards/redeem/route.ts")).toMatch(
      /const PARENT_APPROVAL_MIN_COST = 100/,
    );
    expect(read("src/components/chat/RedeemRewardChip.tsx")).toMatch(
      /const PARENT_APPROVAL_MIN_COST = 100/,
    );
  });

  it("the chat page keys a redeem chip by its OWN operationId, not by list position", () => {
    // The chip FREEZES operationId at mount (retry safety), so a React key that
    // omitted it would let a NEW proposal inherit the frozen key of a proposal
    // that no longer exists at that slot — and the route's 409 `duplicate` would
    // answer a redemption that never happened, which the chip then reports as
    // "Already redeemed ✓". chat-store dedupes identical proposals within a turn
    // so the collision is unreachable today; the key carries the id anyway so a
    // future change to that key cannot turn it into a silent money-path lie.
    const page = read("src/app/chat/page.tsx");
    const redeemKey = /key=\{`redeem\|[^`]*`\}/.exec(page)?.[0];
    expect(redeemKey).toBeDefined();
    expect(redeemKey).toContain("${p.operationId}");
  });
});
