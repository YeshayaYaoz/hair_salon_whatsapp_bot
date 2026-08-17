import { describe, it, expect, vi, afterEach } from "vitest";
import { createMessageTemplate, countTemplateVariables } from "./whatsappClient.js";

/**
 * Templates fail in a way that costs days: Meta accepts the request, reviews it, and rejects it, and
 * the reason arrives as a category rather than a diagnosis. Everything checkable before sending is
 * therefore checked before sending.
 */

describe("countTemplateVariables", () => {
  it("counts distinct placeholders, not occurrences", () => {
    expect(countTemplateVariables("שלום {{1}}, התור שלך אצל {{2}} — נתראה {{1}}")).toBe(2);
  });

  it("is zero for a body with no variables", () => {
    expect(countTemplateVariables("היי, כאן תורי אונליין.")).toBe(0);
  });
});

describe("createMessageTemplate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses to submit a template whose variables have no examples", async () => {
    // Meta requires one sample per variable and rejects the whole template without them. Our four
    // existing templates all carry variables and were submitted with none.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await createMessageTemplate("waba", "tok", {
      name: "t",
      languageCode: "he",
      bodyText: "שלום {{1}}, נתראה ב-{{2}}",
    });

    expect(result.submitted).toBe(false);
    expect(result.error).toMatch(/2 variable\(s\) but 0 example/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the count is close but wrong", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await createMessageTemplate("waba", "tok", {
      name: "t",
      languageCode: "he",
      bodyText: "שלום {{1}}, נתראה ב-{{2}}",
      bodyExample: ["נועה"],
    });

    expect(result.submitted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends examples in the row-of-values shape Meta expects", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1", status: "PENDING" })));
    vi.stubGlobal("fetch", fetchMock);

    await createMessageTemplate("waba", "tok", {
      name: "t",
      languageCode: "he",
      bodyText: "שלום {{1}}",
      bodyExample: ["נועה"],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.components[0].example).toEqual({ body_text: [["נועה"]] });
  });

  it("carries the footer and opt-out button a marketing template needs", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1", status: "PENDING" })));
    vi.stubGlobal("fetch", fetchMock);

    await createMessageTemplate("waba", "tok", {
      name: "outreach",
      languageCode: "he",
      bodyText: "היי, כאן תורי אונליין. משהו על {{1}} כאן.",
      bodyExample: ["מספרת רונית"],
      category: "MARKETING",
      footerText: "לא רלוונטי? השיבו הסר.",
      quickReplies: ["הסירו אותי"],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.category).toBe("MARKETING");
    expect(body.components).toContainEqual({ type: "FOOTER", text: "לא רלוונטי? השיבו הסר." });
    expect(body.components).toContainEqual({
      type: "BUTTONS",
      buttons: [{ type: "QUICK_REPLY", text: "הסירו אותי" }],
    });
  });

  it("omits the example key entirely when there are no variables", async () => {
    // An empty example array is itself a rejection; absent is the correct shape.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1", status: "PENDING" })));
    vi.stubGlobal("fetch", fetchMock);

    await createMessageTemplate("waba", "tok", { name: "t", languageCode: "he", bodyText: "היי." });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.components[0]).not.toHaveProperty("example");
  });
});
