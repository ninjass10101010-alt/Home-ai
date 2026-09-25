import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  getServiceConfig: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mocks.sendMail })),
  },
}));

vi.mock("@/lib/services/config", () => ({
  getServiceConfig: mocks.getServiceConfig,
}));

import { sendEmailAlert, sendSMSViaEmail } from "@/lib/free-communication";

const TEST_COPY = "CONSUELA TEST ALERT — Test only. No emergency.";

beforeEach(() => {
  mocks.sendMail.mockReset().mockResolvedValue({ accepted: [] });
  mocks.getServiceConfig.mockReset().mockResolvedValue("configured");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("test-only emergency delivery copy", () => {
  it("uses test-only SMS subject content when requested", async () => {
    await sendSMSViaEmail("+15551234567", TEST_COPY, "verizon", { testOnly: true, subject: TEST_COPY } as any);

    const options = mocks.sendMail.mock.calls[0][0];
    expect(options.subject).toBe(TEST_COPY);
    expect(options.text).toContain(TEST_COPY);
  });

  it("uses test-only email subject and HTML when requested", async () => {
    await sendEmailAlert("person@example.com", TEST_COPY, TEST_COPY, { testOnly: true } as any);

    const options = mocks.sendMail.mock.calls[0][0];
    expect(options.subject).toBe(TEST_COPY);
    expect(options.html).toContain(TEST_COPY);
    expect(options.html).not.toContain("EMERGENCY ALERT");
  });
});
