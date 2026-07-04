export type Lang = "en" | "he";

const translations = {
  en: {
    nav: {
      analytics: "Analytics", appointments: "Appointments", customers: "Customers",
      waitlist: "Waitlist", services: "Services", staff: "Staff", hours: "Hours",
      whatsapp: "WhatsApp", faq: "FAQ", settings: "Settings", billing: "Billing", logout: "Log out",
    },
    days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    daysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],

    // Analytics
    analyticsTitle: "Analytics", analyticsSubtitle: "Overview of your salon's performance",
    thisMonth: "This month", revenue: "Revenue this month",
    newCustomers: "New customers", allTime: "All-time bookings",
    last7Days: "Last 7 days", topServices: "Top services",
    setupChecklist: "Get started", setupSubtitle: "Complete these steps to go live:",
    stepServices: "Add your services", stepServicesHint: "List what you offer with prices and durations",
    stepHours: "Set your opening hours", stepHoursHint: "The bot won't book outside your hours",
    stepWhatsapp: "Connect WhatsApp", stepWhatsappHint: "One-click setup via Meta — takes 2 minutes",
    stepBilling: "Activate subscription", stepBillingHint: "Keep the bot live after your trial ends",

    // Appointments
    appointmentsTitle: "Appointments", appointmentsSubtitle: "Bookings made through WhatsApp",
    upcoming: "Upcoming", past: "Past", cancelled: "Cancelled", all: "All",
    when: "When", customer: "Customer", service: "Service", staff: "Staff", status: "Status",
    noAppointments: "No appointments found.", searchPlaceholder: "Search by name or phone…",
    exportCsv: "Export CSV",

    // Analytics stat subtitles
    subCancelled: "cancelled", subRevenue: "from confirmed bookings",
    subNewCustomers: "booked this month", subAllTime: "confirmed total",

    // Services
    servicesTitle: "Services", addService: "Add a service",
    serviceName: "Service name", price: "Price (₪)", duration: "Duration (min)",
    descriptionOptional: "Description (optional)",
    noServices: "No services yet. Add one below.",
    servicesSubtitle: "Add the services your salon offers.",

    // Staff
    staffTitle: "Staff",
    staffSubtitle: "Add the people who work at your salon. Customers can specify a preferred stylist when booking.",
    addStaffMember: "Add a staff member", staffName: "Name",
    noStaff: "No staff members yet. Add one below.", remove: "Remove",

    // Hours
    hoursTitle: "Opening Hours", hoursSubtitle: "Set when your salon is open for bookings",
    saveHours: "Save hours", to: "to",

    // WhatsApp
    whatsappTitle: "WhatsApp", whatsappSubtitle: "Connect your Meta WhatsApp Business number",
    connected: "Connected", notConnected: "Not connected",
    phoneNumberId: "Phone Number ID", accessToken: "Access Token",
    phoneNumberIdPlaceholder: "e.g. 123456789012345",
    accessTokenPlaceholder: "Permanent access token from Meta",
    whatsappHint: "Find these in your Meta Business app under WhatsApp › API Setup. Use a permanent token.",

    // FAQ
    faqTitle: "FAQ",
    faqSubtitle: "Common questions your WhatsApp bot can use to answer customers (e.g. parking, payment, cancellation policy).",
    addFaqEntry: "Add an entry", question: "Question", answer: "Answer",
    noFaq: "No FAQ entries yet. Add one below.",
    questionPlaceholder: "Question (e.g. Do you have parking?)", answerPlaceholder: "Answer",

    // Customers
    customersTitle: "Customers", totalCustomers: "total customers", totalBookings: "Total bookings",
    noCustomers: "No customers yet — they'll appear here after their first booking.",

    // Waitlist
    waitlistTitle: "Waitlist", waitlistSubtitle: "Customers waiting for a slot to open up",
    pendingWaitlist: "Pending", notifiedWaitlist: "Notified",
    markNotified: "Mark notified", noWaitlist: "No one on the waitlist yet.",

    // Settings
    settingsTitle: "Settings", settingsSubtitle: "Salon profile and bot configuration",
    businessProfile: "Business profile", businessProfileDesc: "Basic info shown to customers via the bot.",
    bookingNotifications: "Booking notifications",
    bookingNotificationsDesc: "Get a WhatsApp message on your phone every time a customer books.",
    botPersonalityTitle: "Bot personality",
    botPersonalityDesc: "Customize how the bot introduces itself and speaks to customers.",
    salonName: "Salon name", address: "Address", timezone: "Timezone", loginEmail: "Login email",
    notifPhone: "Your WhatsApp number", notifPhoneHint: "Include country code, e.g. 972501234567.",
    googleMapsUrl: "Google Maps review link", googleMapsUrlHint: "Sent with post-visit thank-you messages. Find it in Google Business Profile → Share → Copy link.",
    greeting: "Opening greeting", personality: "Personality & tone",
    greetingPlaceholder: "e.g. Hello! Welcome to Shir's salon 💇‍♀️ How can I help?",
    personalityPlaceholder: "e.g. Be friendly and use emojis occasionally. Always respond in Hebrew.",

    // Customers
    sendMessage: "Send message", messagePlaceholder: "Type a message to send via WhatsApp…",
    send: "Send", sending: "Sending…", messageSent: "Message sent",

    // Appointments view toggle
    listView: "List", calendarView: "Calendar",

    // Trial banner
    trialBanner: (days: number) => `Your free trial ends in ${days} day${days !== 1 ? "s" : ""}. Subscribe to keep the bot running.`,
    trialBannerExpired: "Your free trial has ended. Subscribe now to keep the bot running.",
    subscribeCta: "Subscribe →",

    // Settings: reminders / reviews toggles + template warning
    automatedMessages: "Automated messages", automatedMessagesDesc: "Control which WhatsApp messages the bot sends automatically.",
    remindersLabel: "24-hour appointment reminders",
    reviewsLabel: "Post-visit review requests",
    templateWarning: "WhatsApp only allows proactive messages to customers who have messaged you in the last 24 hours. Reminders and review requests may be silently blocked for other customers.",

    // Billing
    billingTitle: "Billing", billingSubtitle: "Manage your subscription",
    subscriptionStatus: "Subscription status",
    subscribeNow: "Subscribe now", reactivate: "Reactivate subscription",
    manageBilling: "Manage billing & invoices",
    redirecting: "Redirecting…",
    whatsappWarning: "Connect your WhatsApp number before subscribing — the bot won't go live without it.",
    billingStatuses: {
      trial: { label: "Trial", description: "You're on a free trial. Subscribe to keep the bot running." },
      active: { label: "Active", description: "Your subscription is active. The bot is live." },
      past_due: { label: "Past due", description: "Payment failed. Update your payment method to restore access." },
      canceled: { label: "Canceled", description: "Your subscription has been canceled." },
    },

    // Common
    save: "Save changes", saving: "Saving…", saved: "Saved",
    loading: "Loading…", cancel: "Cancel", delete: "Delete", add: "Add", edit: "Edit",
    search: "Search…", noBookings: "No bookings yet.",
  },

  he: {
    nav: {
      analytics: "סטטיסטיקות", appointments: "תורים", customers: "לקוחות",
      waitlist: "רשימת המתנה", services: "שירותים", staff: "צוות", hours: "שעות פעילות",
      whatsapp: "וואטסאפ", faq: "שאלות נפוצות", settings: "הגדרות", billing: "תשלום", logout: "התנתקות",
    },
    days: ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"],
    daysShort: ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"],

    // Analytics
    analyticsTitle: "סטטיסטיקות", analyticsSubtitle: "סקירת ביצועי הסלון שלך",
    thisMonth: "החודש", revenue: "הכנסות החודש",
    newCustomers: "לקוחות חדשים", allTime: "סה\"כ הזמנות",
    last7Days: "7 הימים האחרונים", topServices: "שירותים מובילים",
    setupChecklist: "מתחילים להגדיר", setupSubtitle: "השלם את השלבים הבאים כדי להתחיל:",
    stepServices: "הוסף שירותים", stepServicesHint: "הכנס את השירותים שלך עם מחירים ומשכים",
    stepHours: "הגדר שעות פעילות", stepHoursHint: "הבוט לא יקבע תורים מחוץ לשעות הפעילות",
    stepWhatsapp: "חבר וואטסאפ", stepWhatsappHint: "חיבור בלחיצה אחת דרך מטא — לוקח 2 דקות",
    stepBilling: "הפעל מנוי", stepBillingHint: "שמור על הבוט פעיל לאחר תקופת הניסיון",

    // Appointments
    appointmentsTitle: "תורים", appointmentsSubtitle: "הזמנות שנקבעו דרך וואטסאפ",
    upcoming: "קרובים", past: "עבר", cancelled: "בוטלו", all: "הכל",
    when: "מועד", customer: "לקוח", service: "שירות", staff: "עובד", status: "סטטוס",
    noAppointments: "לא נמצאו תורים.", searchPlaceholder: "חיפוש לפי שם או טלפון…",
    exportCsv: "ייצוא CSV",

    // Analytics stat subtitles
    subCancelled: "בוטלו", subRevenue: "מהזמנות מאושרות",
    subNewCustomers: "הזמינו החודש", subAllTime: "סה\"כ מאושרות",

    // Services
    servicesTitle: "שירותים", addService: "הוסף שירות",
    serviceName: "שם השירות", price: "מחיר (₪)", duration: "משך (דקות)",
    descriptionOptional: "תיאור (אופציונלי)",
    noServices: "אין שירותים עדיין. הוסף אחד למטה.",
    servicesSubtitle: "הוסף את השירותים שהסלון שלך מציע.",

    // Staff
    staffTitle: "צוות",
    staffSubtitle: "הוסף את אנשי הצוות בסלון. לקוחות יכולים לבחור ספר/ית מועדפ/ת בעת ההזמנה.",
    addStaffMember: "הוסף איש/ת צוות", staffName: "שם",
    noStaff: "אין אנשי צוות עדיין. הוסף למטה.", remove: "הסר",

    // Hours
    hoursTitle: "שעות פעילות", hoursSubtitle: "הגדר מתי הסלון פתוח לקביעת תורים",
    saveHours: "שמור שעות", to: "עד",

    // WhatsApp
    whatsappTitle: "וואטסאפ", whatsappSubtitle: "חבר את מספר הוואטסאפ העסקי שלך",
    connected: "מחובר", notConnected: "לא מחובר",
    phoneNumberId: "מזהה מספר הטלפון", accessToken: "טוקן גישה",
    phoneNumberIdPlaceholder: "לדוג׳ 123456789012345",
    accessTokenPlaceholder: "טוקן גישה קבוע ממטא",
    whatsappHint: "ניתן למצוא את הפרטים בממשק מטא תחת WhatsApp › API Setup. השתמש בטוקן קבוע.",

    // FAQ
    faqTitle: "שאלות נפוצות",
    faqSubtitle: "שאלות ותשובות שהבוט ישתמש בהן כדי לענות ללקוחות (לדוג׳ חניה, תשלום, מדיניות ביטול).",
    addFaqEntry: "הוסף שאלה", question: "שאלה", answer: "תשובה",
    noFaq: "אין שאלות נפוצות עדיין. הוסף למטה.",
    questionPlaceholder: "שאלה (לדוג׳ האם יש חניה?)", answerPlaceholder: "תשובה",

    // Customers
    customersTitle: "לקוחות", totalCustomers: "לקוחות בסה\"כ", totalBookings: "סה\"כ הזמנות",
    noCustomers: "אין לקוחות עדיין — הם יופיעו כאן לאחר ההזמנה הראשונה.",

    // Waitlist
    waitlistTitle: "רשימת המתנה", waitlistSubtitle: "לקוחות שממתינים למועד פנוי",
    pendingWaitlist: "ממתינים", notifiedWaitlist: "עודכנו",
    markNotified: "סמן כמעודכן", noWaitlist: "אין ממתינים ברשימה.",

    // Settings
    settingsTitle: "הגדרות", settingsSubtitle: "פרופיל הסלון והגדרות הבוט",
    businessProfile: "פרופיל העסק", businessProfileDesc: "מידע בסיסי שמוצג ללקוחות דרך הבוט.",
    bookingNotifications: "התראות הזמנה",
    bookingNotificationsDesc: "קבל הודעת וואטסאפ בכל פעם שלקוח קובע תור.",
    botPersonalityTitle: "אישיות הבוט",
    botPersonalityDesc: "התאם כיצד הבוט מציג את עצמו ומדבר עם לקוחות.",
    salonName: "שם הסלון", address: "כתובת", timezone: "אזור זמן", loginEmail: "אימייל כניסה",
    notifPhone: "מספר הוואטסאפ שלך", notifPhoneHint: "כולל קידומת מדינה, לדוג׳ 972501234567.",
    googleMapsUrl: "קישור לביקורת Google Maps", googleMapsUrlHint: "יישלח עם הודעות תודה לאחר הביקור. מצא אותו בפרופיל העסק Google ← שתף ← העתק קישור.",
    greeting: "ברכת פתיחה", personality: "אישיות וטון",
    greetingPlaceholder: "לדוג׳ שלום! ברוכים הבאים לסלון שיר 💇‍♀️ במה אוכל לעזור?",
    personalityPlaceholder: "לדוג׳ היה ידידותי ותשתמש באמוג׳ים מדי פעם. תמיד ענה בעברית.",

    // Customers
    sendMessage: "שלח הודעה", messagePlaceholder: "הקלד הודעה לשליחה בוואטסאפ…",
    send: "שלח", sending: "שולח…", messageSent: "ההודעה נשלחה",

    // Appointments view toggle
    listView: "רשימה", calendarView: "לוח שנה",

    // Trial banner
    trialBanner: (days: number) => `תקופת הניסיון שלך מסתיימת בעוד ${days} יום${days !== 1 ? "ים" : ""}. הירשם כדי להמשיך.`,
    trialBannerExpired: "תקופת הניסיון שלך הסתיימה. הירשם עכשיו כדי להמשיך.",
    subscribeCta: "הרשמה ←",

    // Settings: reminders / reviews toggles + template warning
    automatedMessages: "הודעות אוטומטיות", automatedMessagesDesc: "שלוט אילו הודעות הבוט שולח אוטומטית.",
    remindersLabel: "תזכורות 24 שעות לפני תור",
    reviewsLabel: "בקשות ביקורת לאחר הביקור",
    templateWarning: "וואטסאפ מאפשר הודעות יזומות רק ללקוחות שכתבו לכם ב-24 השעות האחרונות. תזכורות ובקשות ביקורת עלולות להיחסם בשקט עבור לקוחות אחרים.",

    // Billing
    billingTitle: "תשלום", billingSubtitle: "נהל את המנוי שלך",
    subscriptionStatus: "סטטוס מנוי",
    subscribeNow: "הירשם עכשיו", reactivate: "הפעל מנוי מחדש",
    manageBilling: "נהל חיוב וחשבוניות",
    redirecting: "מפנה…",
    whatsappWarning: "חבר את מספר הוואטסאפ לפני ההרשמה — הבוט לא יעלה לאוויר בלי זה.",
    billingStatuses: {
      trial: { label: "ניסיון", description: "אתה בתקופת ניסיון חינמית. הירשם כדי להמשיך." },
      active: { label: "פעיל", description: "המנוי שלך פעיל. הבוט עובד." },
      past_due: { label: "חוב", description: "התשלום נכשל. עדכן את אמצעי התשלום לשחזור הגישה." },
      canceled: { label: "בוטל", description: "המנוי שלך בוטל." },
    },

    // Common
    save: "שמור שינויים", saving: "שומר…", saved: "נשמר",
    loading: "טוען…", cancel: "ביטול", delete: "מחק", add: "הוסף", edit: "עריכה",
    search: "חיפוש…", noBookings: "אין הזמנות עדיין.",
  },
} as const;

type DeepString<T> = T extends string
  ? string
  : T extends ((...args: any[]) => string)
  ? (...args: any[]) => string
  : T extends readonly string[]
  ? readonly string[]
  : { [K in keyof T]: DeepString<T[K]> };

export type Translations = DeepString<typeof translations.en>;
export { translations };
