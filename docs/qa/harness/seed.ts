/**
 * Local QA seed: one realistic salon (Hebrew), plus a second business so the super-admin list
 * has more than one row. Not part of the app — lives in the scratchpad.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const EMAIL = "qa@torionline.test";
const PASSWORD = "QaPassword123";

function at(dayOffset: number, hour: number, min = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, min, 0, 0);
  return d;
}

async function main() {
  await prisma.$transaction([
    prisma.apiUsageEvent.deleteMany({}),
    prisma.conversationMessage.deleteMany({}),
    prisma.waitlistEntry.deleteMany({}),
    prisma.appointment.deleteMany({}),
    prisma.customer.deleteMany({}),
    prisma.blockedTime.deleteMany({}),
    prisma.faqEntry.deleteMany({}),
    prisma.businessHours.deleteMany({}),
    prisma.staffMember.deleteMany({}),
    prisma.service.deleteMany({}),
    prisma.emailVerificationToken.deleteMany({}),
    prisma.passwordResetToken.deleteMany({}),
  ]);
  await prisma.business.deleteMany({});

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const biz = await prisma.business.create({
    data: {
      name: "מספרת אור",
      email: EMAIL,
      passwordHash,
      address: "דיזנגוף 120, תל אביב",
      timezone: "Asia/Jerusalem",
      subscriptionStatus: "active",
      subscriptionPlan: "premium",
      billingCycle: "monthly",
      billingCyclesCompleted: 7,
      loyaltyDiscountIls: 20,
      nextBillingDate: at(11, 9),
      walletBalanceAgorot: 4250,
      messagesUsedThisCycle: 312,
      businessType: "salon",
      businessTypeChosenAt: at(-60, 10),
      emailVerifiedAt: at(-60, 10),
      notificationPhone: "0521234567",
      whatsappPhoneNumberId: "123456789012345",
      whatsappWabaId: "998877665544332",
      whatsappRegisteredAt: at(-59, 12),
      googleMapsUrl: "https://maps.app.goo.gl/example",
      botGreeting: "שלום! הגעת למספרת אור 💇 איך אפשר לעזור?",
      botPersonality: "חמה, קצרה ולעניין",
      cancellationPolicy: "ביטול עד 24 שעות לפני התור, אחרת נחויב 50% מהמחיר.",
      referralText: "ממליצה עלינו לחברה? שתיכן מקבלות 10% הנחה.",
      pricingNotes: "צבע ארוך במיוחד — תוספת לפי אורך. חבילות טיפולים בתיאום טלפוני.",
      remindersEnabled: true,
      reviewsEnabled: true,
      digestEnabled: true,
      depositEnabled: true,
      depositAmountIls: 50,
      depositHoldMinutes: 30,
      paymentProvider: "payplus",
      paymentWebhookSecret: "seedwebhooksecret",
      invoiceProvider: "greeninvoice",
      aiProvider: "anthropic",
    },
  });

  const services = await Promise.all(
    [
      { name: "תספורת אישה", priceCents: 12000, durationMin: 45, color: "#1B7FA0", description: "כולל שטיפה וסידור" },
      { name: "צבע שורש", priceCents: 28000, durationMin: 90, color: "#9333EA", description: "צבע מקצועי" },
      { name: "פן", priceCents: 8000, durationMin: 30, color: "#DB2777" },
      { name: "החלקה", priceCents: 65000, durationMin: 180, color: "#059669", description: "החלקת קרטין" },
      { name: "תספורת גבר", priceCents: 6000, durationMin: 30, color: "#F59E0B" },
      { name: "סדנת עיצוב שיער (קבוצתי)", priceCents: 15000, durationMin: 120, color: "#DC2626", capacity: 8 },
    ].map((s) => prisma.service.create({ data: { ...s, businessId: biz.id } }))
  );

  const staff = await Promise.all(
    ["אור", "מיכל", "דנה"].map((name) => prisma.staffMember.create({ data: { name, businessId: biz.id } }))
  );

  // Sun–Thu 09:00–19:00, Fri 09:00–14:00, Sat closed (no row)
  for (const [dayOfWeek, openMin, closeMin] of [
    [0, 540, 1140],
    [1, 540, 1140],
    [2, 540, 1140],
    [3, 540, 1140],
    [4, 540, 1140],
    [5, 540, 840],
  ] as number[][]) {
    await prisma.businessHours.create({ data: { businessId: biz.id, dayOfWeek, openMin, closeMin } });
  }

  await prisma.blockedTime.createMany({
    data: [
      { businessId: biz.id, startTime: at(3, 13), endTime: at(3, 14), reason: "הפסקת צהריים" },
      { businessId: biz.id, startTime: at(14, 9), endTime: at(18, 19), reason: "חופשה" },
    ],
  });

  const customerData = [
    { phone: "972521111111", name: "נועה לוי", notes: "רגישה לאמוניה" },
    { phone: "972522222222", name: "יעל כהן" },
    { phone: "972523333333", name: "רוני בר" },
    { phone: "972524444444", name: "אבי מזרחי", botPaused: true, botPausedAt: at(-1, 15) },
    { phone: "972525555555", name: null },
    { phone: "972526666666", name: "שירה אזולאי" },
    { phone: "972527777777", name: "תמר גולן" },
  ];
  const customers = [];
  for (const c of customerData) {
    customers.push(
      await prisma.customer.create({
        data: { ...c, businessId: biz.id, preferredServiceId: services[0].id },
      })
    );
  }

  // Appointments: past (for analytics/revenue), today, upcoming, cancelled, pending deposit.
  const appts: any[] = [];
  for (let w = 1; w <= 10; w++) {
    for (let i = 0; i < 4; i++) {
      const svc = services[i % services.length];
      const start = at(-w * 3, 10 + i * 2);
      appts.push({
        businessId: biz.id,
        customerId: customers[(w + i) % customers.length].id,
        serviceId: svc.id,
        staffId: staff[i % staff.length].id,
        startTime: start,
        endTime: new Date(start.getTime() + svc.durationMin * 60000),
        status: "confirmed",
        reviewSentAt: at(-w * 3, 20),
      });
    }
  }
  // today
  appts.push(
    {
      businessId: biz.id,
      customerId: customers[0].id,
      serviceId: services[0].id,
      staffId: staff[0].id,
      startTime: at(0, 11),
      endTime: at(0, 11, 45),
      status: "confirmed",
    },
    {
      businessId: biz.id,
      customerId: customers[1].id,
      serviceId: services[1].id,
      staffId: staff[1].id,
      startTime: at(0, 14),
      endTime: at(0, 15, 30),
      status: "confirmed",
    }
  );
  // upcoming
  for (let d = 1; d <= 12; d++) {
    const svc = services[d % services.length];
    const start = at(d, 9 + (d % 6));
    appts.push({
      businessId: biz.id,
      customerId: customers[d % customers.length].id,
      serviceId: svc.id,
      staffId: staff[d % staff.length].id,
      startTime: start,
      endTime: new Date(start.getTime() + svc.durationMin * 60000),
      status: "confirmed",
    });
  }
  // cancelled + pending deposit
  appts.push(
    {
      businessId: biz.id,
      customerId: customers[2].id,
      serviceId: services[3].id,
      staffId: staff[0].id,
      startTime: at(2, 16),
      endTime: at(2, 19),
      status: "cancelled",
    },
    {
      businessId: biz.id,
      customerId: customers[5].id,
      serviceId: services[3].id,
      staffId: staff[2].id,
      startTime: at(4, 12),
      endTime: at(4, 15),
      status: "pending_payment",
      depositAmountIls: 50,
      depositStatus: "pending",
      depositProvider: "payplus",
      depositPaymentUrl: "https://example.com/pay/abc",
      depositExpiresAt: at(0, 23, 59),
    }
  );
  for (const a of appts) await prisma.appointment.create({ data: a });

  await prisma.waitlistEntry.createMany({
    data: [
      { businessId: biz.id, customerId: customers[3].id, serviceId: services[1].id, notified: false },
      { businessId: biz.id, customerId: customers[6].id, serviceId: services[3].id, notified: true },
    ],
  });

  await prisma.faqEntry.createMany({
    data: [
      { businessId: biz.id, question: "יש חניה?", answer: "יש חניון בתשלום בבניין הסמוך, וחניה כחול-לבן ברחוב." },
      { businessId: biz.id, question: "אפשר לשלם באשראי?", answer: "כן, כל כרטיסי האשראי, ביט ומזומן." },
      { businessId: biz.id, question: "כמה זמן לוקחת החלקה?", answer: "בין שעתיים לשלוש, תלוי באורך השיער." },
      { businessId: biz.id, question: "אתם עובדים בשבת?", answer: "לא, אנחנו סגורים בשבת." },
    ],
  });

  // Conversations + usage ledger
  const convo = [
    ["user", "היי, אפשר תור לתספורת מחר?"],
    ["assistant", "בשמחה! יש לי מחר ב-10:00 או ב-14:30. מה מתאים לך?"],
    ["user", "10:00 מעולה"],
    ["assistant", "קבעתי לך תספורת אישה מחר ב-10:00 עם אור. נתראה! 💇"],
    ["user", "תודה רבה"],
  ];
  for (const c of customers.slice(0, 4)) {
    let i = 0;
    for (const [role, content] of convo) {
      await prisma.conversationMessage.create({
        data: { businessId: biz.id, phone: c.phone, role, content, createdAt: at(-2, 10, i * 3) },
      });
      i++;
    }
  }
  for (let d = 0; d < 30; d++) {
    for (const c of customers.slice(0, 4)) {
      await prisma.apiUsageEvent.create({
        data: {
          businessId: biz.id,
          customerPhone: c.phone,
          kind: "claude",
          provider: "anthropic",
          model: "claude-haiku-4-5-20251001",
          inputTokens: 3200 + d * 7,
          cacheReadTokens: 2600,
          cacheWriteTokens: 180,
          outputTokens: 140,
          costAgorot: 3,
          createdAt: at(-d, 12),
        },
      });
      await prisma.apiUsageEvent.create({
        data: {
          businessId: biz.id,
          customerPhone: c.phone,
          kind: "whatsapp",
          category: d % 3 === 0 ? "utility" : "service",
          billable: d % 3 === 0,
          createdAt: at(-d, 12, 5),
        },
      });
    }
  }

  // Second + third business so the super-admin fleet list has variety
  await prisma.business.create({
    data: {
      name: "צימר הגליל",
      email: "bnb@torionline.test",
      passwordHash,
      subscriptionStatus: "trial",
      businessType: "bnb",
      bookingModel: "inquiry",
      availabilityInfo: "בדרך כלל יש מקום באמצע השבוע. סופי שבוע מתמלאים חודש מראש.",
      pricingNotes: "בין הזמנים — מחיר מלא לכל לילה.",
      createdAt: at(-9, 10),
    },
  });
  await prisma.business.create({
    data: {
      name: "קליניקת דרמה",
      email: "clinic@torionline.test",
      passwordHash,
      subscriptionStatus: "past_due",
      subscriptionPlan: "standard",
      businessType: "clinic",
      nextBillingDate: at(-4, 9),
      createdAt: at(-120, 10),
    },
  });

  for (let d = 29; d >= 0; d--) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    date.setHours(0, 0, 0, 0);
    await prisma.businessMetricSnapshot.upsert({
      where: { date },
      update: {},
      create: {
        date,
        mrrIls: 1200 + (29 - d) * 35,
        activeCount: 8 + Math.floor((29 - d) / 6),
        trialCount: 3,
        pastDueCount: 1,
        canceledCount: 2,
      },
    });
  }

  console.log(`Seeded. Login: ${EMAIL} / ${PASSWORD}  (businessId=${biz.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
