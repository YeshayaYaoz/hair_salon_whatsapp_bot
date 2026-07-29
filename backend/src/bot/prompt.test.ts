import { describe, it, expect, vi } from "vitest";

// buildSystemPrompt pulls in prisma via the module graph; formatDuration itself is pure, so stub
// the client rather than standing up a database for a formatting test.
vi.mock("../lib/prisma.js", () => ({ prisma: {} }));

const { formatDuration } = await import("./prompt.js");

describe("formatDuration", () => {
  it("keeps minutes for appointment-based businesses", () => {
    expect(formatDuration(30, false)).toBe("30 דקות");
    expect(formatDuration(1440, false)).toBe("1440 דקות");
  });

  // The bug this guards: a B&B quoted real customers "לילה — יחידה זוגית: ₪900 (1440 דקות)".
  it("renders overnight stays in nights, with correct singular/plural", () => {
    expect(formatDuration(1440, true)).toBe("לילה");
    expect(formatDuration(2880, true)).toBe("2 לילות");
    expect(formatDuration(4320, true)).toBe("3 לילות");
  });

  // Falling back is deliberate: rounding a partial stay to the nearest night would quote the
  // customer a different stay than the owner configured.
  it("falls back to minutes when an overnight duration isn't whole nights", () => {
    expect(formatDuration(2000, true)).toBe("2000 דקות");
    expect(formatDuration(60, true)).toBe("60 דקות");
  });
});
