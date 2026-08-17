import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
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
  // The real wait is seconds long, on purpose. Tests assert the retry happens, not how long it naps.
  beforeEach(() => { process.env.WHATSAPP_TEMPLATE_DELETE_SETTLE_MS = "0"; });

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

  it("replaces a REJECTED template instead of reporting success", async () => {
    // The failure this closes: the zimmer ran for weeks with tori_appointment_reminder REJECTED.
    // Every retry hit "already exists", which was read as success, so the retry button reported
    // that everything was fine while no reminder outside the 24h window could ever be delivered.
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        const method = init?.method ?? "GET";
        calls.push(`${method} ${String(url).includes("name=") ? "byName" : "create"}`);
        if (method === "POST" && calls.filter((c) => c === "POST create").length === 1) {
          return new Response(JSON.stringify({ error: { message: "Template name already exists" } }), { status: 400 });
        }
        if (method === "GET") return new Response(JSON.stringify({ data: [{ status: "REJECTED", language: "he" }] }));
        if (method === "DELETE") return new Response(JSON.stringify({ success: true }));
        return new Response(JSON.stringify({ id: "1", status: "PENDING" }));
      })
    );

    const result = await createMessageTemplate("waba", "tok", {
      name: "tori_appointment_reminder",
      languageCode: "he",
      bodyText: "שלום {{1}}",
      bodyExample: ["נועה"],
    });

    expect(calls).toContain("DELETE byName");
    expect(result.submitted).toBe(true);
    expect(result.status).toBe("PENDING");
  });

  it("waits out an asynchronous deletion rather than failing on it", async () => {
    // Meta's DELETE returns success while the old content is still going away, and a create in that
    // gap is refused with a message that only means "too soon".
    let creates = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        creates += 1;
        if (creates === 1) return new Response(JSON.stringify({ error: { message: "Template name already exists" } }), { status: 400 });
        if (creates === 2) {
          return new Response(JSON.stringify({ error: { message: "New Hebrew content can't be added while the existing Hebrew content is being deleted." } }), { status: 400 });
        }
        return new Response(JSON.stringify({ id: "1", status: "PENDING" }));
      }
      if (method === "DELETE") return new Response(JSON.stringify({ success: true }));
      return new Response(JSON.stringify({ data: [{ status: "REJECTED", language: "he" }] }));
    }));

    const result = await createMessageTemplate("waba", "tok", {
      name: "t", languageCode: "he", bodyText: "שלום {{1}}", bodyExample: ["נועה"],
    });

    expect(result.submitted).toBe(true);
    expect(result.status).toBe("PENDING");
    expect(creates).toBe(3);
  });

  it("leaves an APPROVED template alone", async () => {
    const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
      if ((init?.method ?? "GET") === "POST") {
        return new Response(JSON.stringify({ error: { message: "Template name already exists" } }), { status: 400 });
      }
      return new Response(JSON.stringify({ data: [{ status: "APPROVED", language: "he" }] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createMessageTemplate("waba", "tok", {
      name: "t", languageCode: "he", bodyText: "שלום {{1}}", bodyExample: ["נועה"],
    });

    expect(result.status).toBe("APPROVED");
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(false);
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
