# 1. Overwrite the file with explicit white background and dark text styles
cat << 'EOF' > app/privacy/page.tsx
import React from 'react';

export default function PrivacyPolicy() {
  return (
    <div style={{ backgroundColor: '#ffffff', minHeight: '100vh', width: '100%' }}>
      <div style={{ 
        padding: '40px 20px', 
        maxWidth: '800px', 
        margin: '0 auto', 
        fontFamily: 'sans-serif', 
        color: '#1a1a1a',
        lineHeight: '1.6'
      }}>
        <h1>Privacy Policy for Tori</h1>
        <p><strong>Last Updated:</strong> July 5, 2026</p>

        <p>Welcome to Tori (torionline.com). We are committed to protecting your privacy. This Privacy Policy explains how we collect, use, and protect your information when you use our automated WhatsApp booking bot, admin dashboard, and related services.</p>

        <h2>1. Information We Collect</h2>
        <ul>
          <li><strong>Account Information:</strong> Name, email address, and phone number when you register an account on our dashboard.</li>
          <li><strong>Google Calendar Data:</strong> When you securely connect your Google Calendar to Tori, we request access to view, edit, and manage your calendar events via the <code>https://www.googleapis.com/auth/calendar.events</code> scope.</li>
        </ul>

        <h2>2. How We Use Your Information</h2>
        <p>We use your data strictly to run the automated booking workflows you configure:</p>
        <ul>
          <li><strong>Calendar Availability (Read Access):</strong> Our automated bot checks your calendar to see when you are busy, ensuring clients booking via WhatsApp are only offered open, available slots.</li>
          <li><strong>Event Creation (Write Access):</strong> When a client successfully schedules an appointment through the WhatsApp bot, Tori automatically injects that event directly into your Google Calendar.</li>
          <li><strong>Notifications:</strong> We use your contact details to send you real-time updates regarding new bookings or system alerts.</li>
        </ul>

        <h2>3. How We Share Your Information</h2>
        <p>We do not sell, rent, or lease your personal information or calendar data to third parties. We only share data with trusted service infrastructure (such as secure database and hosting providers) strictly necessary to run the application, and only under strict confidentiality agreements.</p>

        <h2>4. Google API Services User Data Policy (Limited Use Disclosure)</h2>
        <p>Tori's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer" style={{ color: '#0056b3' }}>Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
        <ul>
          <li>We only use Google Calendar data to provide the core scheduling features visible in our interface and executed by our bot.</li>
          <li>We do not transfer this data to third parties, unless required by law or as part of a necessary structural business transition.</li>
          <li>We absolutely do not use or transfer your Google Calendar data to serve advertisements, track user behavior across other apps, or build advertising profiles.</li>
          <li>No humans are allowed to read your calendar data unless you give us explicit permission for troubleshooting, it is required for security investigations, or it is necessary to comply with legal regulations.</li>
        </ul>

        <h2>5. Data Retention and Security</h2>
        <p>Your data security is our priority. Your Google OAuth refresh tokens are encrypted and stored safely within our production database backend. We retain your information only as long as your account is active. If you choose to disconnect your calendar or delete your Tori account, all associated Google tokens and calendar records are instantly and permanently purged from our servers.</p>

        <h2>6. Contact Us</h2>
        <p>If you have any questions about this policy or your data privacy, please contact us at: <strong>y28112000@gmail.com</strong></p>
      </div>
    </div>
  );
}
EOF

# 2. Stage, commit, and push the fix
git add app/privacy/page.tsx
git commit -m "fix: force white background and dark text on privacy policy page"
git push origin main
