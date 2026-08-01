export type Lang = "en" | "he";

const translations = {
  en: {
    nav: {
      analytics: "Analytics", appointments: "Appointments", customers: "Customers",
      waitlist: "Waitlist", services: "Pricing & Services", staff: "Staff", hours: "Schedule",
      blocked: "Time off", conversations: "Conversations",
      whatsapp: "WhatsApp", bot: "Bot", payments: "Payments", faq: "FAQ", settings: "Settings", billing: "Billing", logout: "Log out",
    },
    navGroups: { setup: "Get started", overview: "Home", operations: "Day-to-day", business: "My business", account: "Setup & account" },
    // Bottom-tab labels. The full nav names are written for the sidebar and overflow a ~56px tab
    // ("Pricing & Services" / "מחירים ושירותים" truncated to an ellipsis), so the four tabs get
    // their own short forms rather than being cut off.
    navShort: { analytics: "Home", appointments: "Bookings", customers: "Customers", services: "Services" },
    days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    daysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    today: "Today", previousWeek: "Previous week", nextWeek: "Next week",
    awaitingDeposit: "Awaiting deposit",
    loadFailed: "Couldn't load this list", retry: "Try again",
    skipToContent: "Skip to content",
    brandTagline: "WhatsApp appointment booking", leadFinder: "Lead Finder", adminSection: "Admin",

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
    servicesTitle: "Pricing & Services", addService: "Add a service",
    serviceName: "Service name", price: "Price (₪)", duration: "Duration (min)",
    durationNights: "Nights", nightsAbbrev: "n",
    capacity: "Spots", capacityHint: "How many people can book the same slot (1 = a normal 1:1 appointment; higher = a group class)",
    descriptionOptional: "Description (optional)",
    imageUrlOptional: "Photo link (optional)",
    linkUrlOptional: "More info link (optional)",
    photos: "Photos",
    photosHint: "The bot sends these on WhatsApp when a customer asks to see photos. Paste a public image link (https://…) — one per photo.",
    addPhoto: "Add photo",
    removePhoto: "Remove photo",
    photoCount: (n: number) => `${n} photo${n === 1 ? "" : "s"}`,
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
    customerPhoneCol: "Phone", customerIdCol: "ID",
    customersHint: "Click any customer to view their WhatsApp conversation with the bot and send messages.",
    viewConversation: "View conversation",
    noCustomers: "No customers yet — they'll appear here after their first booking.",

    // Waitlist
    waitlistTitle: "Waitlist", waitlistSubtitle: "Customers waiting for a slot to open up",
    pendingWaitlist: "Pending", notifiedWaitlist: "Notified",
    markNotified: "Mark notified", noWaitlist: "No one on the waitlist yet.",

    // Settings
    settingsTitle: "Settings", settingsSubtitle: "Salon profile and business details",
    businessProfile: "Business profile", businessProfileDesc: "Basic info shown to customers via the bot.",
    bookingNotifications: "Booking notifications",
    bookingNotificationsDesc: "Get a WhatsApp message on your phone every time a customer books.",

    // Bot
    botTabTitle: "Bot", botTabSubtitle: "How the bot talks, and what it sends automatically",
    botPersonalityTitle: "Bot personality",
    botPersonalityDesc: "Customize how the bot introduces itself and speaks to customers.",
    salonName: "Salon name", address: "Address", timezone: "Timezone", loginEmail: "Login email",
    notifPhone: "Your personal phone (owner) — not the bot's number", notifPhoneHint: "This is YOUR own WhatsApp number, where you'll get alerts about new bookings and customer requests. It is different from the business number the bot answers on. Include country code, e.g. 972501234567.",
    googleMapsUrl: "Google Maps link", googleMapsUrlHint: "Used for two things: the bot sends it when customers ask for directions, and it's attached to post-visit thank-you messages. Find it in Google Business Profile → Share → Copy link.",
    greeting: "Opening greeting", personality: "Personality & tone",
    greetingPlaceholder: "e.g. Hello! Welcome to Shir's salon 💇‍♀️ How can I help?",
    personalityPlaceholder: "e.g. Be friendly and use emojis occasionally. Always respond in Hebrew.",

    // Customers
    sendMessage: "Send message", messagePlaceholder: "Type a message to send via WhatsApp…",
    send: "Send", sending: "Sending…", messageSent: "Message sent",

    // Appointments view toggle
    listView: "List", calendarView: "Calendar",
    newAppointment: "New appointment",

    // Trial banner
    trialBanner: (days: number) => `Your free trial ends in ${days} day${days !== 1 ? "s" : ""}. Subscribe to keep the bot running.`,
    trialDaysLeft: (days: number) => `${days} day${days !== 1 ? "s" : ""} left in your free trial`,
    trialBannerNudge: "Subscribe now to keep your WhatsApp bot answering customers.",
    trialBannerExpired: "Your free trial has ended — subscribe to reactivate your bot.",
    subscribeCta: "Subscribe",

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
      waitlist: "רשימת המתנה", services: "מחירים ושירותים", staff: "צוות", hours: "לוח זמנים",
      blocked: "חופשות", conversations: "שיחות",
      whatsapp: "וואטסאפ", bot: "בוט", payments: "סליקה וחשבוניות", faq: "שאלות נפוצות", settings: "הגדרות", billing: "תשלום", logout: "התנתקות",
    },
    navGroups: { setup: "הפעלה ראשונית", overview: "ראשי", operations: "ניהול יומי", business: "העסק שלי", account: "הגדרות וחשבון" },
    navShort: { analytics: "ראשי", appointments: "תורים", customers: "לקוחות", services: "מחירים" },
    days: ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"],
    daysShort: ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"],
    today: "היום", previousWeek: "השבוע הקודם", nextWeek: "השבוע הבא",
    awaitingDeposit: "ממתין למקדמה",
    loadFailed: "לא הצלחנו לטעון את הרשימה", retry: "נסו שוב",
    skipToContent: "דילוג לתוכן",
    brandTagline: "הזמנת תורים בוואטסאפ", leadFinder: "מציאת לידים", adminSection: "ניהול",

    // Analytics
    analyticsTitle: "סטטיסטיקות", analyticsSubtitle: "מה קורה בעסק — במבט אחד",
    thisMonth: "החודש", revenue: "הכנסות החודש",
    newCustomers: "לקוחות חדשים", allTime: "סה\"כ תורים",
    last7Days: "7 הימים האחרונים", topServices: "השירותים הכי מבוקשים",
    setupChecklist: "יאללה, מתחילים 🚀", setupSubtitle: "עוד כמה צעדים קטנים והבוט באוויר:",
    stepServices: "הוסיפו שירותים", stepServicesHint: "מה אתם מציעים, כמה זה עולה וכמה זמן זה לוקח",
    stepHours: "הגדירו שעות פעילות", stepHoursHint: "שהבוט ידע מתי אתם פתוחים — הוא לא יקבע כשאתם סגורים",
    stepWhatsapp: "חברו וואטסאפ", stepWhatsappHint: "חיבור בלחיצה אחת דרך מטא — לוקח 2 דקות",
    stepBilling: "הפעילו מנוי", stepBillingHint: "כדי שהבוט לא ייעצר כשתקופת הניסיון נגמרת",

    // Appointments
    appointmentsTitle: "תורים", appointmentsSubtitle: "כל התורים שנקבעו בוואטסאפ — במקום אחד",
    upcoming: "קרובים", past: "היסטוריה", cancelled: "בוטלו", all: "הכל",
    when: "מועד", customer: "לקוח", service: "שירות", staff: "עובד", status: "סטטוס",
    noAppointments: "עדיין אין פה תורים", searchPlaceholder: "חפשו שם או טלפון…",
    exportCsv: "ייצוא CSV",

    // Analytics stat subtitles
    subCancelled: "בוטלו", subRevenue: "מהזמנות מאושרות",
    subNewCustomers: "הזמינו החודש", subAllTime: "סה\"כ מאושרות",

    // Services
    servicesTitle: "מחירים ושירותים", addService: "הוספת שירות",
    serviceName: "שם השירות", price: "מחיר (₪)", duration: "משך (דקות)",
    durationNights: "לילות", nightsAbbrev: "ל׳",
    capacity: "מקומות", capacityHint: "כמה אנשים יכולים להזמין את אותו מועד (1 = תור רגיל אחד-על-אחד; יותר = שיעור קבוצתי)",
    descriptionOptional: "תיאור (לא חובה)",
    imageUrlOptional: "קישור לתמונה (לא חובה)",
    linkUrlOptional: "קישור למידע נוסף (לא חובה)",
    photos: "תמונות",
    photosHint: "הבוט שולח את התמונות האלה בוואטסאפ כשלקוח מבקש לראות. הדביקו קישור ציבורי לתמונה (https://…) — קישור אחד לכל תמונה.",
    addPhoto: "הוספת תמונה",
    removePhoto: "הסרת תמונה",
    photoCount: (n: number) => (n === 1 ? "תמונה אחת" : `${n} תמונות`),
    noServices: "עוד לא הוספתם שירותים — זה השלב הראשון, יאללה 👇",
    servicesSubtitle: "מה אתם מציעים? תספורת, צבע, טיפול פנים — הכל נכנס לפה.",

    // Staff
    staffTitle: "צוות",
    staffSubtitle: "מי עובד אצלכם? לקוחות יוכלו לבקש מישהו ספציפי כשהם קובעים תור.",
    addStaffMember: "הוספת איש/ת צוות", staffName: "שם",
    noStaff: "עוד אין אנשי צוות. מוסיפים למטה 👇", remove: "הסרה",

    // Hours
    hoursTitle: "שעות פעילות", hoursSubtitle: "מתי אתם פתוחים? הבוט יקבע תורים רק בשעות האלה.",
    saveHours: "שמירת שעות", to: "עד",

    // WhatsApp
    whatsappTitle: "וואטסאפ", whatsappSubtitle: "מחברים את הוואטסאפ של העסק — ומכאן הבוט עונה בשבילכם",
    connected: "מחובר", notConnected: "לא מחובר",
    phoneNumberId: "מזהה מספר הטלפון", accessToken: "טוקן גישה",
    phoneNumberIdPlaceholder: "לדוג׳ 123456789012345",
    accessTokenPlaceholder: "טוקן גישה קבוע ממטא",
    whatsappHint: "ניתן למצוא את הפרטים בממשק מטא תחת WhatsApp › API Setup. השתמש בטוקן קבוע.",

    // FAQ
    faqTitle: "שאלות נפוצות",
    faqSubtitle: "שאלות שחוזרות על עצמן? תנו לבוט תשובות מוכנות והוא יענה לבד (חניה, ביטולים, אמצעי תשלום…).",
    addFaqEntry: "הוספת שאלה", question: "שאלה", answer: "תשובה",
    noFaq: "עוד אין שאלות. מוסיפים למטה 👇",
    questionPlaceholder: "שאלה (למשל: יש חניה?)", answerPlaceholder: "תשובה",

    // Customers
    customersTitle: "לקוחות", totalCustomers: "לקוחות בסה\"כ", totalBookings: "סה\"כ תורים",
    customerPhoneCol: "טלפון", customerIdCol: "מזהה",
    customersHint: "לוחצים על לקוח כדי לראות את השיחה שלו עם הבוט ולשלוח לו הודעה.",
    viewConversation: "לשיחה",
    noCustomers: "עדיין אין לקוחות — ברגע שמישהו יכתוב לבוט, הוא יופיע כאן.",

    // Waitlist
    waitlistTitle: "רשימת המתנה", waitlistSubtitle: "לקוחות שמחכים שיתפנה מקום",
    pendingWaitlist: "ממתינים", notifiedWaitlist: "עודכנו",
    markNotified: "סימון כעודכן", noWaitlist: "אין כרגע ממתינים",

    // Settings
    settingsTitle: "הגדרות", settingsSubtitle: "פרופיל הסלון ופרטי העסק",
    businessProfile: "פרופיל העסק", businessProfileDesc: "מידע בסיסי שמוצג ללקוחות דרך הבוט.",
    bookingNotifications: "התראות הזמנה",
    bookingNotificationsDesc: "קבל הודעת וואטסאפ בכל פעם שלקוח קובע תור.",

    // Bot
    botTabTitle: "בוט", botTabSubtitle: "איך הבוט מדבר, ומה הוא שולח אוטומטית",
    botPersonalityTitle: "אישיות הבוט",
    botPersonalityDesc: "איך הבוט מדבר? רשמי, קליל, עם אימוג׳ים — אתם קובעים.",
    salonName: "שם הסלון", address: "כתובת", timezone: "אזור זמן", loginEmail: "אימייל כניסה",
    notifPhone: "המספר האישי שלך (בעל/ת העסק) — לא מספר הבוט", notifPhoneHint: "זהו מספר הוואטסאפ האישי שלך, שאליו יגיעו התראות על תורים חדשים ובקשות מלקוחות. זה שונה מהמספר העסקי שהבוט עונה עליו. כולל קידומת מדינה, לדוג׳ 972501234567.",
    googleMapsUrl: "קישור Google Maps", googleMapsUrlHint: "משמש לשני דברים: הבוט שולח אותו כשלקוחות מבקשים הוראות הגעה או ניווט, והוא מצורף להודעות התודה אחרי הביקור. מצא אותו בפרופיל העסק Google ← שתף ← העתק קישור.",
    greeting: "ברכת פתיחה", personality: "אישיות וטון",
    greetingPlaceholder: "לדוג׳ שלום! ברוכים הבאים לסלון שיר 💇‍♀️ במה אוכל לעזור?",
    personalityPlaceholder: "לדוג׳ היה ידידותי ותשתמש באמוג׳ים מדי פעם. תמיד ענה בעברית.",

    // Customers
    sendMessage: "שלח הודעה", messagePlaceholder: "הקלד הודעה לשליחה בוואטסאפ…",
    send: "שלח", sending: "שולח…", messageSent: "ההודעה נשלחה",

    // Appointments view toggle
    listView: "רשימה", calendarView: "לוח שנה",
    newAppointment: "תור חדש",

    // Trial banner
    trialBanner: (days: number) => `תקופת הניסיון נגמרת בעוד ${days === 1 ? "יום" : days === 2 ? "יומיים" : `${days} ימים`}. הירשמו כדי להמשיך.`,
    trialDaysLeft: (days: number) => days === 1 ? "נשאר יום אחד לתקופת הניסיון" : days === 2 ? "נשארו יומיים לתקופת הניסיון" : `נשארו ${days} ימים לתקופת הניסיון`,
    trialBannerNudge: "הירשמו עכשיו כדי שהבוט ימשיך לענות ללקוחות בוואטסאפ בלי הפסקה.",
    trialBannerExpired: "תקופת הניסיון נגמרה — הירשמו והבוט חוזר לעבוד תוך דקה.",
    subscribeCta: "להרשמה",

    // Settings: reminders / reviews toggles + template warning
    automatedMessages: "הודעות אוטומטיות", automatedMessagesDesc: "שלוט אילו הודעות הבוט שולח אוטומטית.",
    remindersLabel: "תזכורות 24 שעות לפני תור",
    reviewsLabel: "בקשות ביקורת לאחר הביקור",
    templateWarning: "וואטסאפ מאפשר הודעות יזומות רק ללקוחות שכתבו לכם ב-24 השעות האחרונות. תזכורות ובקשות ביקורת עלולות להיחסם בשקט עבור לקוחות אחרים.",

    // Billing
    billingTitle: "תשלום", billingSubtitle: "המנוי, התשלומים והארנק — הכל פה",
    subscriptionStatus: "סטטוס מנוי",
    subscribeNow: "להרשמה עכשיו", reactivate: "הפעלת המנוי מחדש",
    manageBilling: "ניהול חיוב וחשבוניות",
    redirecting: "רגע…",
    whatsappWarning: "רגע! קודם מחברים וואטסאפ — בלי זה הבוט לא באוויר.",
    billingStatuses: {
      trial: { label: "ניסיון", description: "אתם בתקופת ניסיון חינם. שווה להירשם לפני שהיא נגמרת." },
      active: { label: "פעיל", description: "הכל טוב — המנוי פעיל והבוט עובד. 💪" },
      past_due: { label: "חוב", description: "החיוב האחרון לא עבר. עדכנו אמצעי תשלום כדי שהבוט ימשיך לעבוד." },
      canceled: { label: "בוטל", description: "המנוי בוטל. אפשר לחדש מתי שרוצים." },
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
