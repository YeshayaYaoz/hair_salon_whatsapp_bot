import { prisma } from "./prisma.js";
import { TEMPLATES, type BusinessType } from "./businessTemplates.js";

export interface ApplyTemplateResult {
  businessType: BusinessType;
  firstTime: boolean;
  seededServices: number;
  appliedPresets: string[]; // which fields were actually written (skipped ones were already customized)
}

/**
 * Applies a category template to a business.
 *
 * Safe to call more than once (e.g. the owner switches category later):
 *  - `businessType` is always updated.
 *  - String presets (tone/policy/referral) only overwrite fields that are still empty, so a
 *    manually-edited policy is never clobbered.
 *  - Boolean/number toggles (deposit/reminders/…) and seed services only apply on the FIRST
 *    selection — re-picking a category won't silently flip a switch the owner has since changed
 *    or re-add example services they deleted.
 */
export async function applyTemplate(businessId: string, type: BusinessType): Promise<ApplyTemplateResult> {
  const template = TEMPLATES[type];
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    include: { _count: { select: { services: true } } },
  });

  const firstTime = business.businessTypeChosenAt === null;
  const appliedPresets: string[] = [];
  const data: Record<string, unknown> = {
    businessType: type,
    businessTypeChosenAt: business.businessTypeChosenAt ?? new Date(),
  };

  // String presets: only fill in fields the owner hasn't written yet.
  const isEmpty = (v: string | null) => v === null || v.trim() === "";
  if (isEmpty(business.botPersonality) && template.presets.botPersonality) {
    data.botPersonality = template.presets.botPersonality;
    appliedPresets.push("botPersonality");
  }
  if (isEmpty(business.cancellationPolicy) && template.presets.cancellationPolicy) {
    data.cancellationPolicy = template.presets.cancellationPolicy;
    appliedPresets.push("cancellationPolicy");
  }
  if (isEmpty(business.referralText) && template.presets.referralText) {
    data.referralText = template.presets.referralText;
    appliedPresets.push("referralText");
  }
  if (isEmpty(business.availabilityInfo) && template.presets.availabilityInfo) {
    data.availabilityInfo = template.presets.availabilityInfo;
    appliedPresets.push("availabilityInfo");
  }

  // Toggles/amounts: only on the very first selection, so re-picking never flips an owner's setting.
  if (firstTime) {
    data.remindersEnabled = template.presets.remindersEnabled;
    data.reviewsEnabled = template.presets.reviewsEnabled;
    data.digestEnabled = template.presets.digestEnabled;
    data.depositEnabled = template.presets.depositEnabled;
    data.depositAmountIls = template.presets.depositAmountIls;
    data.depositHoldMinutes = template.presets.depositHoldMinutes;
    data.bookingModel = template.presets.bookingModel;
    appliedPresets.push(
      "remindersEnabled",
      "reviewsEnabled",
      "digestEnabled",
      "depositEnabled",
      "depositAmountIls",
      "depositHoldMinutes",
      "bookingModel"
    );
  }

  // Seed example services only on first selection AND only if the business has none yet.
  let seededServices = 0;
  if (firstTime && business._count.services === 0) {
    await prisma.service.createMany({
      data: template.seedServices.map((s) => ({
        businessId,
        name: s.name,
        durationMin: s.durationMin,
        priceCents: s.priceCents,
        color: s.color,
      })),
    });
    seededServices = template.seedServices.length;
  }

  await prisma.business.update({ where: { id: businessId }, data });

  return { businessType: type, firstTime, seededServices, appliedPresets };
}
