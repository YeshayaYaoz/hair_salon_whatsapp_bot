import Link from "next/link";
import Image from "next/image";

const SECTIONS = [
  { id: "acceptance", title: "1. Acceptance of Terms" },
  { id: "the-service", title: "2. The Service" },
  { id: "accounts", title: "3. Accounts & Eligibility" },
  { id: "subscriptions", title: "4. Subscriptions, Trials & Billing" },
  { id: "acceptable-use", title: "5. Acceptable Use" },
  { id: "whatsapp-compliance", title: "6. WhatsApp & Messaging Compliance" },
  { id: "customer-data", title: "7. Your Customers' Data" },
  { id: "ai-disclaimer", title: "8. AI-Generated Responses" },
  { id: "third-party", title: "9. Third-Party Services" },
  { id: "availability", title: "10. Availability & Support" },
  { id: "termination", title: "11. Termination" },
  { id: "disclaimers", title: "12. Disclaimers & Limitation of Liability" },
  { id: "changes", title: "13. Changes to These Terms" },
  { id: "governing-law", title: "14. Governing Law" },
  { id: "contact", title: "15. Contact Us" },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 mb-10">
      <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-100">{title}</h2>
      <div className="text-[15px] text-gray-600 leading-relaxed flex flex-col gap-3">{children}</div>
    </section>
  );
}

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-[#F4F6F8]">
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
        <nav className="hidden md:block sticky top-10 self-start">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">On this page</p>
          <ul className="flex flex-col gap-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block text-xs text-gray-500 hover:text-[#1B7FA0] py-1.5 transition leading-snug">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
          <Link href="/privacy" className="block text-xs text-[#1B7FA0] hover:underline mt-4 pt-4 border-t border-gray-100">
            View Privacy Policy →
          </Link>
        </nav>

        <main className="bg-white border border-gray-200 rounded-2xl px-6 py-8 sm:px-10 sm:py-10">
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-2 tracking-tight">Terms of Service</h1>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[#1B7FA0]/10 text-[#145F78] border border-[#1B7FA0]/20">
                <span className="w-1.5 h-1.5 rounded-full bg-[#1B7FA0]" />
                Last updated: July 6, 2026
              </span>
            </div>
          </div>

          <Section id="acceptance" title="1. Acceptance of Terms">
            <p>
              These Terms of Service ("Terms") govern your use of Tori (torionline.com), an AI-powered WhatsApp
              booking assistant operated for small businesses ("Business", "you"). By creating an account or
              using the Service, you agree to these Terms. If you do not agree, do not use the Service.
            </p>
          </Section>

          <Section id="the-service" title="2. The Service">
            <p>
              Tori connects to your WhatsApp Business number and uses an AI assistant to answer customer
              messages, check availability, and book, cancel, or reschedule appointments on your behalf. Tori
              also provides a web dashboard for managing services, staff, hours, customers, and billing, and can
              optionally sync bookings to Google Calendar.
            </p>
          </Section>

          <Section id="accounts" title="3. Accounts & Eligibility">
            <p>You must be at least 18 years old and authorized to act on behalf of the business you register. You are responsible for keeping your login credentials secure and for all activity under your account. Notify us immediately of any unauthorized use.</p>
          </Section>

          <Section id="subscriptions" title="4. Subscriptions, Trials & Billing">
            <p>New accounts receive a 14-day free trial. After the trial ends, continued use requires an active paid subscription, billed monthly via PayPlus. You can cancel at any time from the dashboard billing page; cancellation takes effect at the end of the current billing period, and no partial refunds are issued for unused time unless required by law.</p>
            <p>We may change subscription pricing with reasonable advance notice. Continued use after a price change takes effect constitutes acceptance of the new price.</p>
          </Section>

          <Section id="acceptable-use" title="5. Acceptable Use">
            <p>You agree not to use Tori to:</p>
            <ul className="list-disc ps-5 flex flex-col gap-1.5">
              <li>Send unsolicited bulk messages, spam, or content violating WhatsApp's own policies.</li>
              <li>Collect or process customer data for purposes unrelated to appointment booking without their knowledge.</li>
              <li>Attempt to reverse-engineer, disrupt, or gain unauthorized access to the Service or its infrastructure.</li>
              <li>Use the Service for any unlawful purpose or in a way that infringes on others' rights.</li>
            </ul>
            <p>We reserve the right to suspend or terminate accounts that violate this section.</p>
          </Section>

          <Section id="whatsapp-compliance" title="6. WhatsApp & Messaging Compliance">
            <p>
              Your use of WhatsApp messaging through Tori is subject to Meta's WhatsApp Business Platform terms
              and policies. You are responsible for ensuring your use of automated messaging complies with
              applicable messaging consent and opt-out requirements in your jurisdiction. Meta may suspend
              WhatsApp access independently of Tori for policy violations, which would interrupt bot
              functionality until resolved.
            </p>
          </Section>

          <Section id="customer-data" title="7. Your Customers' Data">
            <p>
              As a Business using Tori, you are the data controller for the personal information of your end
              customers (names, phone numbers, appointment details, conversation history) collected through the
              bot. You are responsible for having a lawful basis to collect and process this data and for
              honoring any data requests from your customers. Tori acts as your data processor for this purpose,
              as described in our <Link href="/privacy" className="text-[#1B7FA0] underline underline-offset-2">Privacy Policy</Link>.
            </p>
          </Section>

          <Section id="ai-disclaimer" title="8. AI-Generated Responses">
            <p>
              Tori's bot uses AI (Anthropic's Claude) to interpret and respond to customer messages. While we
              work to make responses accurate and helpful, AI-generated replies may occasionally be incorrect,
              incomplete, or misinterpret a request. You are responsible for reviewing bot configuration
              (services, prices, hours, policies) for accuracy and for monitoring conversations via the dashboard.
              Tori is not liable for losses arising from an AI response that a reasonable business would have
              caught by reviewing its own configured settings.
            </p>
          </Section>

          <Section id="third-party" title="9. Third-Party Services">
            <p>Tori integrates with third-party services including Meta (WhatsApp), Google (Calendar), Anthropic (AI), and PayPlus (billing). Your use of these integrations is also subject to each provider's own terms of service. We are not responsible for outages, policy changes, or data handling by these third parties beyond our control.</p>
          </Section>

          <Section id="availability" title="10. Availability & Support">
            <p>We aim for high availability but do not guarantee uninterrupted service. Scheduled maintenance, third-party outages (WhatsApp, hosting, AI providers), or unforeseen issues may cause temporary disruption. Support is available via the contact details below.</p>
          </Section>

          <Section id="termination" title="11. Termination">
            <p>You may stop using the Service and cancel your subscription at any time from the dashboard. We may suspend or terminate accounts that violate these Terms, engage in abusive behavior, or fail to pay applicable fees. Upon termination, we will handle your data as described in our Privacy Policy.</p>
          </Section>

          <Section id="disclaimers" title="12. Disclaimers & Limitation of Liability">
            <p>The Service is provided "as is" without warranties of any kind, express or implied. To the maximum extent permitted by law, Tori and its operators are not liable for indirect, incidental, or consequential damages, including lost revenue or lost bookings, arising from use of the Service. Our total liability for any claim is limited to the amount you paid us in the three months preceding the claim.</p>
          </Section>

          <Section id="changes" title="13. Changes to These Terms">
            <p>We may update these Terms from time to time. Material changes will be reflected by updating the "Last updated" date above. Continued use of the Service after changes take effect constitutes acceptance of the revised Terms.</p>
          </Section>

          <Section id="governing-law" title="14. Governing Law">
            <p>These Terms are governed by the laws of the State of Israel, without regard to conflict-of-law principles. Any disputes shall be subject to the exclusive jurisdiction of the competent courts of Israel.</p>
          </Section>

          <Section id="contact" title="15. Contact Us">
            <p>Questions about these Terms? Reach out at <a href="mailto:y28112000@gmail.com" className="text-[#1B7FA0] underline underline-offset-2 font-medium">y28112000@gmail.com</a>.</p>
          </Section>
        </main>
      </div>
    </div>
  );
}
