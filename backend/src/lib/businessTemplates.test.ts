import { describe, it, expect } from "vitest";
import { TEMPLATES, BUSINESS_TYPES, listTemplates, isBusinessType } from "./businessTemplates.js";

describe("business templates config", () => {
  it("has a well-formed template for every declared type", () => {
    for (const type of BUSINESS_TYPES) {
      const t = TEMPLATES[type];
      expect(t.type).toBe(type);
      expect(t.emoji).toBeTruthy();
      expect(t.labelHe).toBeTruthy();
      expect(t.labelEn).toBeTruthy();
      expect(t.descriptionHe).toBeTruthy();
      // vocabulary complete
      expect(t.vocabulary.customer).toBeTruthy();
      expect(t.vocabulary.customerPlural).toBeTruthy();
      expect(t.vocabulary.staff).toBeTruthy();
      expect(t.vocabulary.service).toBeTruthy();
    }
  });

  it("seeds at least one service with sane price/duration for each type", () => {
    for (const type of BUSINESS_TYPES) {
      const services = TEMPLATES[type].seedServices;
      expect(services.length).toBeGreaterThan(0);
      for (const s of services) {
        expect(s.name).toBeTruthy();
        expect(s.durationMin).toBeGreaterThan(0);
        expect(s.priceCents).toBeGreaterThanOrEqual(0);
        expect(s.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("keeps deposit presets internally consistent (amount > 0 when enabled)", () => {
    for (const type of BUSINESS_TYPES) {
      const p = TEMPLATES[type].presets;
      if (p.depositEnabled) expect(p.depositAmountIls).toBeGreaterThan(0);
      expect(p.depositHoldMinutes).toBeGreaterThan(0);
    }
  });

  it("listTemplates returns one entry per type", () => {
    expect(listTemplates().map((t) => t.type).sort()).toEqual([...BUSINESS_TYPES].sort());
  });

  it("isBusinessType guards correctly", () => {
    expect(isBusinessType("salon")).toBe(true);
    expect(isBusinessType("bnb")).toBe(false);
    expect(isBusinessType(null)).toBe(false);
  });
});
