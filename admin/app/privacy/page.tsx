import Link from "next/link";
import Image from "next/image";

const SECTIONS = [
  { id: "overview", title: "Overview" },
  { id: "information-we-collect", title: "Information We Collect" },
  { id: "how-we-use", title: "How We Use Information" },
  { id: "ai-processing", title: "AI Processing" },
  { id: "sharing", title: "Sharing & Sub-processors" },
  { id: "google-api", title: "Google API Limited Use" },
  { id: "retention", title: "Data Retention" },
  { id: "security", title: "Security" },
  { id: "rights", title: "Your Rights" },
  { id: "children", title: "Children's Privacy" },
  { id: "transfers", title: "International Transfers" },
  { id: "changes", title: "Changes to This Policy" },
  { id: "contact", title: "Contact Us" },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 mb-10">
      <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-100">{title}</h2>
      <div className="text-[15px] text-gray-600 leading-relaxed flex flex-col gap-3">{children}</div>
    </section>
  );
}

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#F4F6F8]">
      {/* Header */}
      <header className="bg-[#0D2A38] px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/tori_logo_transparent.png" alt="תורי" width={30} height={30} className="rounded-lg" />
            <span className="font-bold text-white text-base">תורי · Tori</span>
          </Link>
          <Link href="/" className="text-xs text-white/60 hover:text-white transition">← Back to home</Link>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-10 grid md:grid-cols-[220px_1fr] gap-10">
        {/* Table of contents */}
        <nav className="hidden md:block sticky top-10 self-start">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">On this page</p>
          <ul className="flex flex-col gap-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="block text-xs text-gray-500 hover:text-[#1B7FA0] py-1.5 transition leading-snug"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content */}
        <main className="bg-white border border-gray-200 rounded-2xl px-6 py-8 sm:px-10 sm:py-10">
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-2 tracking-tight">Privacy Policy</h1>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[#1B7FA0]/10 text-[#145F78] border border-[#1B7FA0]/20">
                <span className="w-1.5 h-1.5 rounded-full bg-[#1B7FA0]" />
                Last updated: July 6, 2026
              </span>
            </div>
          </div>

          <Section id="overview" title="1. Overview">
            <p>
              Tori (torionline.com) provides an AI-powered WhatsApp booking assistant for small businesses —
              hair salons, clinics, studios, and similar service providers ("Businesses"). This Privacy Policy
              explains what data we collect, why, and how it's handled — covering both the Business owners who
              use our dashboard and the end customers who book appointments through the WhatsApp bot.
            </p>
            <p>
              By using Tori's dashboard, WhatsApp bot, or public booking page, you agree to the practices
              described here. If you're an end customer messaging a business's Tori-powered WhatsApp number,
              your data is processed on behalf of that business, as described below.
            </p>
          </Section>

          <Section id="information-we-collect" title="2. Information We Collect">
            <p><strong>Business account data</strong> — name, email address, password (hashed, never stored in plain text), business name, address, timezone, and configured settings (services, staff, hours, bot personality).</p>
            <p><strong>End-customer data (via the WhatsApp bot)</strong> — when someone messages a business's Tori number, we store their phone number, name (if given), the appointments they book, and the full conversation transcript with the bot, so the business can review it and the bot can maintain context across messages.</p>
            <p><strong>Payment data</strong> — subscription billing is handled entirely by Stripe. We store a Stripe customer/subscription reference ID; we never see or store full card numbers.</p>
            <p><strong>Google Calendar data</strong> — if a business connects Google Calendar, we request the <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">calendar.events</code> scope to read availability and create booking events.</p>
            <p><strong>Technical data</strong> — standard server logs (timestamps, error traces, IP address) for debugging and abuse prevention.</p>
          </Section>

          <Section id="how-we-use" title="3. How We Use Information">
            <ul className="list-disc ps-5 flex flex-col gap-1.5">
              <li>Operating the WhatsApp bot: understanding messages, checking availability, booking/cancelling/rescheduling appointments.</li>
              <li>Syncing confirmed bookings to a business's connected Google Calendar.</li>
              <li>Sending appointment reminders, review requests, and — if enabled — a daily schedule digest to the business owner.</li>
              <li>Processing subscription payments and billing notifications via Stripe.</li>
              <li>Improving reliability and diagnosing bugs from anonymized server logs.</li>
            </ul>
          </Section>

          <Section id="ai-processing" title="4. AI Processing Disclosure">
            <p>
              Tori's bot is powered by Anthropic's Claude API. When a customer messages the WhatsApp bot, their
              message text and relevant business context (services, hours, prior conversation history) are sent
              to Anthropic to generate a response. Anthropic processes this data under its own API terms and does
              not use API data to train its models by default.
            </p>
            <p>We do not use customer conversation data to train any AI model ourselves.</p>
          </Section>

          <Section id="sharing" title="5. Sharing & Sub-processors">
            <p>We do not sell, rent, or trade personal data. We share data only with the infrastructure providers needed to run the service, each bound by their own data protection terms:</p>
            <ul className="list-disc ps-5 flex flex-col gap-1.5">
              <li><strong>Meta (WhatsApp Business Platform)</strong> — transmits and receives WhatsApp messages.</li>
              <li><strong>Anthropic</strong> — processes conversation text to power the AI assistant.</li>
              <li><strong>Google</strong> — Calendar API, only for businesses that opt in to calendar sync.</li>
              <li><strong>Stripe</strong> — subscription billing and payment processing.</li>
              <li><strong>Resend</strong> — transactional emails (password resets, account notifications).</li>
              <li><strong>Railway</strong> — application hosting and database infrastructure.</li>
            </ul>
            <p>We may disclose data if required by law or to protect the rights, safety, or property of Tori, our users, or the public.</p>
          </Section>

          <Section id="google-api" title="6. Google API Services User Data Policy (Limited Use)">
            <p>
              Tori's use and transfer of information received from Google APIs adheres to the{" "}
              <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer" className="text-[#1B7FA0] underline underline-offset-2">
                Google API Services User Data Policy
              </a>, including the Limited Use requirements.
            </p>
            <ul className="list-disc ps-5 flex flex-col gap-1.5">
              <li>Google Calendar data is used only to check availability and create booking events — the core scheduling feature visible in our interface.</li>
              <li>We do not transfer this data to third parties, except as necessary to provide the feature itself (e.g. our hosting infrastructure) or as required by law.</li>
              <li>We do not use Google Calendar data for advertising, ad targeting, or building user profiles.</li>
              <li>No human at Tori reads calendar data except with explicit user permission for troubleshooting, or as required for security investigations or legal compliance.</li>
            </ul>
          </Section>

          <Section id="retention" title="7. Data Retention">
            <p>Business account data is retained for as long as the account is active. If a business disconnects Google Calendar or deletes their account, associated OAuth tokens and calendar sync records are purged immediately.</p>
            <p>Conversation history between the bot and end customers is retained to preserve context and give business owners a record of past interactions; only the most recent messages are actively used by the bot, and older messages are pruned automatically.</p>
            <p>Cancelled appointments and expired trial data may be retained for a limited period for accounting and dispute-resolution purposes, then deleted.</p>
          </Section>

          <Section id="security" title="8. Security">
            <p>Passwords are hashed and never stored in plain text. WhatsApp access tokens, Google OAuth tokens, and other credentials are encrypted at rest. All traffic to our dashboard and API is served over HTTPS. Webhook requests from Meta are verified using HMAC signatures to prevent spoofing.</p>
          </Section>

          <Section id="rights" title="9. Your Rights">
            <p>
              <strong>Business owners</strong> can access, correct, or export their data from the dashboard at any
              time, and can request full account deletion by contacting us below.
            </p>
            <p>
              <strong>End customers</strong> who booked an appointment through a business's WhatsApp bot can
              request that we delete their conversation history and stored personal data by contacting us or the
              relevant business directly. We will action deletion requests within a reasonable time, subject to
              any legal obligation to retain specific records.
            </p>
          </Section>

          <Section id="children" title="10. Children's Privacy">
            <p>Tori is intended for business use and is not directed at children under 16. We do not knowingly collect personal data from children. If you believe a child has provided us data, contact us and we will delete it.</p>
          </Section>

          <Section id="transfers" title="11. International Data Transfers">
            <p>Tori operates from Israel and uses infrastructure providers that may process data in other countries (including the United States). By using our services, you consent to your data being transferred and processed outside your country of residence where applicable, with appropriate safeguards in place.</p>
          </Section>

          <Section id="changes" title="12. Changes to This Policy">
            <p>We may update this Privacy Policy from time to time. Material changes will be reflected by updating the "Last updated" date above. Continued use of Tori after changes take effect constitutes acceptance of the revised policy.</p>
          </Section>

          <Section id="contact" title="13. Contact Us">
            <p>Questions about this policy or your data? Reach out at <a href="mailto:y28112000@gmail.com" className="text-[#1B7FA0] underline underline-offset-2 font-medium">y28112000@gmail.com</a>.</p>
          </Section>
        </main>
      </div>
    </div>
  );
}
