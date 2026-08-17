import { describe, it, expect } from "vitest";
import { matchServiceName, normalizeServiceName, unknownServiceMessage } from "./serviceMatch.js";

// The live B&B's own units, exactly as stored — quotes and all. This is the data that broke the
// call, so it is the data the tests run on.
const UNITS = [
  { name: 'צימר "חיטה"' },
  { name: '"תמר" - יחידה משפחתית' },
  { name: '"גפן" - יחידה משפחתית' },
  { name: 'צימר "תאנה"' },
];

describe("matchServiceName", () => {
  // The exact failure: four tool calls, four "Unknown service", for a unit sitting in the database.
  it("matches the bare name a caller says against the quoted name the owner stored", () => {
    const m = matchServiceName("חיטה", UNITS);
    expect(m.kind).toBe("fuzzy");
    expect(m.kind === "fuzzy" && m.service.name).toBe('צימר "חיטה"');
  });

  it("matches every other unit of that business too", () => {
    for (const [spoken, stored] of [
      ["גפן", '"גפן" - יחידה משפחתית'],
      ["תמר", '"תמר" - יחידה משפחתית'],
      ["תאנה", 'צימר "תאנה"'],
    ] as const) {
      const m = matchServiceName(spoken, UNITS);
      expect(m.kind === "fuzzy" && m.service.name).toBe(stored);
    }
  });

  it("still prefers an exact name over a contained one", () => {
    const services = [{ name: "תספורת" }, { name: "תספורת ילדים" }];
    const m = matchServiceName("תספורת", services);
    expect(m.kind).toBe("exact");
    expect(m.kind === "exact" && m.service.name).toBe("תספורת");
  });

  it("accepts the full stored name, which is what a careful agent sends", () => {
    expect(matchServiceName('צימר "חיטה"', UNITS).kind).toBe("exact");
    // Quotes dropped by transcription, and the rest intact.
    expect(matchServiceName("צימר חיטה", UNITS).kind).toBe("exact");
  });

  // Sending one unit's photos to someone asking about another is worse than asking which.
  it("refuses to choose when the name fits more than one unit", () => {
    const m = matchServiceName("יחידה משפחתית", UNITS);
    expect(m.kind).toBe("ambiguous");
    expect(m.kind === "ambiguous" && m.candidates).toHaveLength(2);
  });

  // Word-level containment, not substring: this is what stops "אנה" matching "תאנה".
  it("does not match a fragment of a word", () => {
    expect(matchServiceName("אנה", UNITS).kind).toBe("none");
    expect(matchServiceName("חיט", UNITS).kind).toBe("none");
  });

  it("has nothing to say about an empty name", () => {
    expect(matchServiceName("", UNITS).kind).toBe("none");
    expect(matchServiceName("   ", UNITS).kind).toBe("none");
  });

  it("is case-insensitive for the salons whose services are in English", () => {
    const m = matchServiceName("HAIRCUT", [{ name: "Haircut" }]);
    expect(m.kind).toBe("exact");
  });
});

describe("normalizeServiceName", () => {
  it("strips the punctuation owners write and callers never say", () => {
    expect(normalizeServiceName('צימר "חיטה"')).toBe("צימר חיטה");
    expect(normalizeServiceName('"גפן" - יחידה משפחתית')).toBe("גפן יחידה משפחתית");
  });

  // Invisible, survives a copy-paste out of a right-to-left document, and breaks an equality test
  // with nothing on screen to explain why.
  it("removes bidi marks", () => {
    expect(normalizeServiceName("‏חיטה‎")).toBe("חיטה");
  });
});

describe("unknownServiceMessage", () => {
  // "Unknown service" told the model nothing, so it retried the same argument and then improvised.
  it("names the real options so the agent can retry correctly", () => {
    const msg = unknownServiceMessage(UNITS);
    expect(msg).toContain('צימר "חיטה"');
    expect(msg).toContain('"גפן" - יחידה משפחתית');
  });

  it("tells the agent to stop rather than retry when the salon has no services at all", () => {
    expect(unknownServiceMessage([])).toContain("אל תנסה שוב");
  });
});
