const SITE_URL = "https://torionline.com";

// Only render this on the actual marketing homepages (/ and /en) — putting it in the root
// layout meant every URL on the site (dashboard, login, a customer's public booking page, etc.)
// carried the same self-reported AggregateRating, which is what Search Console's "Review
// snippet" structured-data check was flagging.
export const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "תורי",
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/tori_logo_transparent.png`,
      },
      description:
        "בוט WhatsApp AI לקביעת תורים אוטומטית לעסקים קטנים — סלוני שיער, קליניקות, ספרים ועוד.",
      areaServed: "IL",
      availableLanguage: ["Hebrew", "English"],
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: "תורי",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: SITE_URL,
      description:
        "מערכת הזמנת תורים אוטומטית דרך WhatsApp עם סנכרון גוגל קלנדר ובינה מלאכותית.",
      offers: [
        {
          "@type": "Offer",
          name: "Standard",
          price: "189",
          priceCurrency: "ILS",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: "189",
            priceCurrency: "ILS",
            billingDuration: "P1M",
          },
        },
        {
          "@type": "Offer",
          name: "Premium",
          price: "449",
          priceCurrency: "ILS",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: "449",
            priceCurrency: "ILS",
            billingDuration: "P1M",
          },
        },
        {
          "@type": "Offer",
          name: "Ultra",
          price: "849",
          priceCurrency: "ILS",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: "849",
            priceCurrency: "ILS",
            billingDuration: "P1M",
          },
        },
      ],
      // No `aggregateRating` here. It previously claimed 4.9 from 47 reviews — a rating nobody
      // ever left, on a page that carries no reviews at all. Two separate problems: Google's
      // structured-data policy requires a self-serving rating to correspond to reviews visible
      // on the same page (otherwise the rich result is dropped and the site is exposed to a
      // manual action), and the visible page had already, deliberately, dropped its invented
      // testimonials as a legal exposure. Leaving the claim in the JSON-LD just moved the same
      // fabrication somewhere only crawlers read. Restore it when real reviews exist and render
      // on the page.
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "תורי",
      publisher: { "@id": `${SITE_URL}/#organization` },
      inLanguage: ["he-IL", "en-US"],
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "האם הבוט מבין עברית טבעית?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "כן. הבוט מבוסס על Claude AI ומבין עברית טבעית לחלוטין — כולל ניבים, קיצורים ואיות לא מדויק.",
          },
        },
        {
          "@type": "Question",
          name: "כמה זמן לוקחת ההקמה?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "בממוצע 3–10 דקות. מתחברים לוואטסאפ Business, מוסיפים שירותים ושעות, מחברים גוגל קלנדר — והבוט מתחיל לענות.",
          },
        },
        {
          "@type": "Question",
          name: "האם ניתן לבטל בכל עת?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "כן. אין חוזים ואין דמי ביטול. מבטלים בלחיצה אחת מהדשבורד.",
          },
        },
      ],
    },
  ],
};
