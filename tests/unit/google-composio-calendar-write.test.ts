import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const connection = vi.hoisted(() => ({ readConnectionSnapshot: vi.fn() }));

vi.mock("@/lib/google/composio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google/composio")>();
  return { ...actual, executeComposioAction: execute };
});

vi.mock("@/lib/google/connection-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google/connection-state")>();
  return { ...actual, readConnectionSnapshot: connection.readConnectionSnapshot };
});

import { createCalendarEvent } from "@/lib/google/calendar";

beforeEach(() => {
  vi.clearAllMocks();
  connection.readConnectionSnapshot.mockResolvedValue({ connectedAccountId: "account-1" });
});

describe("Composio all-day calendar writes", () => {
  it("creates an all-day event with inclusive start_date and exclusive end_date", async () => {
    execute.mockResolvedValue({ response_data: { id: "g1" } });
    const result = await createCalendarEvent({
      summary: "No school",
      start: { date: "2026-10-21" },
      end: { date: "2026-10-22" },
    });
    expect(execute).toHaveBeenCalledWith(
      "GOOGLECALENDAR_CREATE_EVENT",
      expect.objectContaining({
        calendar_id: "primary",
        start_date: "2026-10-21",
        end_date: "2026-10-22",
      }),
      "account-1",
    );
    expect(result.id).toBe("g1");
  });

  it("does not send datetime or timezone fields for an all-day event", async () => {
    execute.mockClear();
    execute.mockResolvedValue({ response_data: { id: "g2" } });
    await createCalendarEvent({
      summary: "Trip",
      start: { date: "2026-10-21" },
      end: { date: "2026-10-23" },
    });
    const args = execute.mock.calls[0][1] as Record<string, unknown>;
    expect(args.start_datetime).toBeUndefined();
    expect(args.end_datetime).toBeUndefined();
    expect(args.timezone).toBeUndefined();
  });

  it("keeps the timed path on start_datetime plus duration", async () => {
    execute.mockClear();
    execute.mockResolvedValue({ response_data: { id: "g3" } });
    await createCalendarEvent({
      summary: "Dentist",
      start: { dateTime: "2026-10-21T09:00:00", timeZone: "America/Detroit" },
      end: { dateTime: "2026-10-21T10:00:00", timeZone: "America/Detroit" },
    });
    const args = execute.mock.calls[0][1] as Record<string, unknown>;
    expect(args.start_datetime).toBe("2026-10-21T09:00:00");
    expect(args.event_duration_hour).toBe(1);
    expect(args.event_duration_minutes).toBe(0);
    expect(args.timezone).toBe("America/Detroit");
  });
});
