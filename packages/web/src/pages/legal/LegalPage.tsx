/**
 * Public legal / about page.
 *
 * Why this exists: the Play Store reviewer was told "this section is not
 * available on the website" and that the business legal name was missing. Two
 * real causes, both fixed here:
 *
 *  1. The footer linked to `/agreements`, `/legal/consent` and `/cookies`, all of
 *     which sat inside `<ProtectedRoute>`, so a logged-out visitor (a reviewer, a
 *     search crawler) was redirected to /login and the page looked absent.
 *  2. Nothing on any public page ever named the legal entity, so the reviewer
 *     could not find it to begin with.
 *
 * This page is deliberately static, public, and self-contained: it renders
 * without auth and without an API call, so a reviewer always gets content.
 *
 * Support, grievance and privacy requests all go to the same address, per the
 * product decision that there is no separate registered address or grievance
 * mailbox.
 */
import { useEffect } from 'react';
import { setPageMeta } from '../../lib/seo';

const SUPPORT_EMAIL = 'nabri.support@gmail.com';
const FOUNDER_EMAIL = 'founder_nabri@zohomail.in';
const LEGAL_NAME = 'Nabri';

// Keeps the head in sync so a reviewer opening the shared link (or a crawler)
// sees the legal name in the title and description, not only in the body.
function useLegalMeta() {
  useEffect(() => {
    setPageMeta({
      title: `Legal, Safety & Privacy | ${LEGAL_NAME}`,
      description: `The legal name of this business is ${LEGAL_NAME}. Support, complaints, grievances and privacy requests: ${SUPPORT_EMAIL}. Founder contact: ${FOUNDER_EMAIL}. Safety, payments and refunds.`,
      canonicalPath: '/legal',
    });
  }, []);
}

const SECTIONS: Array<{ id: string; title: string; body: string[] }> = [
  {
    id: 'legal-name',
    title: 'Legal name of the business',
    body: [
      `The legal name of this business is ${LEGAL_NAME}. "${LEGAL_NAME}" is the name under which this website, the Nabri mobile application and all related services are operated.`,
      `All references to "${LEGAL_NAME}", "we", "us" or "our" in these documents mean this business.`,
    ],
  },
  {
    id: 'contact',
    title: 'Contact and support',
    body: [
      `Questions, support requests, complaints, grievances and privacy or data-deletion requests should all be sent to ${SUPPORT_EMAIL}.`,
      `If your message is about the business itself, you can contact the founder directly at ${FOUNDER_EMAIL}.`,
      'You can also raise a complaint in the app using the in-app support option. Support requests are acknowledged and resolved within the period required by applicable law.',
    ],
  },
  {
    id: 'age',
    title: 'Minimum age',
    body: [
      'Nabri is not intended for use by anyone below 18 years of age, and we do not knowingly collect personal data from children below 18.',
    ],
  },
  {
    id: 'safety',
    title: 'Safety',
    body: [
      'Never share your OTP, PIN, password, banking credentials, card PIN or any confidential financial information with anyone, including anyone claiming to represent Nabri. No Nabri representative will ever ask for these.',
      'Meeting people offline carries risk. Choose public places, keep your location sharing with a trusted contact, and use the in-app SOS and report features when something feels wrong.',
      'The Start OTP and Completion OTP steps exist so a partner cannot begin or complete a job without the customer knowing. Partners must never guess, bypass or ask for someone else’s OTP.',
    ],
  },
  {
    id: 'payments',
    title: 'Payments and refunds',
    body: [
      'Payments are processed through a secure third-party payment provider. A payment counts as successful only when the payment provider confirms it. A screenshot, a manually entered transaction ID, or a message in the app is never proof of payment.',
      'Refund eligibility depends on booking status, cancellation timing, payment status and applicable law. A refund is not considered complete until the payment provider confirms it. Where a service has already been delivered, a refund may be refused.',
    ],
  },
  {
    id: 'data',
    title: 'Your data',
    body: [
      'Nabri does not sell your personal data. Data is shared only with service providers who host the platform, process payments, deliver messages or verify identity, and only to the minimum extent needed to operate the service.',
      'During an active booking, a partner may see your name, pickup location and contact number for the duration of that job only.',
      `To request access to, correction of, or deletion of your personal data, email ${SUPPORT_EMAIL}.`,
    ],
  },
  {
    id: 'prohibited',
    title: 'Prohibited conduct',
    body: [
      'Do not impersonate another person or organisation, operate fraudulent accounts, solicit money for deals outside the app, request advance payments, manipulate bookings or the payment system, exploit promotions, bypass security controls, scrape private information, upload malicious code, harass other users, or distribute illegal content.',
      'Accounts that breach these rules may be restricted, suspended or terminated.',
    ],
  },
  {
    id: 'law',
    title: 'Governing law',
    body: [
      'These documents are governed by the laws of India. The courts of India have jurisdiction over disputes arising from them.',
      'This page is a summary. The complete terms are published in the app, and they apply where they differ from this summary.',
    ],
  },
];

export function LegalPage() {
  useLegalMeta();

  return (
    <div className="nb" style={{ minHeight: '100vh', background: 'var(--nb-bg, #fff)' }}>
      <div className="nb-container" style={{ paddingTop: 48, paddingBottom: 64 }}>
        <main id="nb-main">
          <h1
            style={{
              fontSize: 'clamp(2rem, 4vw, 3rem)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              margin: '0 0 8px',
              color: 'var(--nb-ink)',
            }}
          >
            Legal, Safety &amp; Privacy
          </h1>
          <p
            className="nb-body"
            style={{ margin: '0 0 32px', maxWidth: '68ch', color: 'var(--nb-ink-faint)' }}
          >
            The legal name of this business, our contact details, and the policies that
            govern the {LEGAL_NAME} app and website.
          </p>

          {/* The two facts a store reviewer is looking for, stated plainly at the
              top rather than buried in prose. */}
          <section
            aria-label="Business identification"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 16,
              marginBottom: 40,
            }}
          >
            <div
              style={{
                border: '1px solid var(--nb-line, #e5e5e5)',
                borderRadius: 14,
                padding: '18px 20px',
              }}
            >
              <h2 style={{ margin: '0 0 6px', fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--nb-ink-faint)' }}>
                Legal name
              </h2>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--nb-ink)' }}>
                {LEGAL_NAME}
              </p>
            </div>
            <div
              style={{
                border: '1px solid var(--nb-line, #e5e5e5)',
                borderRadius: 14,
                padding: '18px 20px',
              }}
            >
              <h2 style={{ margin: '0 0 6px', fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--nb-ink-faint)' }}>
                Support, complaints &amp; privacy
              </h2>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--nb-ink)' }}>
                <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'inherit' }}>
                  {SUPPORT_EMAIL}
                </a>
              </p>
            </div>
          </section>

          {SECTIONS.map((section) => (
            <section
              key={section.id}
              id={section.id}
              style={{ marginBottom: 32, scrollMarginTop: 24 }}
            >
              <h2
                style={{
                  margin: '0 0 10px',
                  fontSize: 20,
                  fontWeight: 700,
                  color: 'var(--nb-ink)',
                }}
              >
                {section.title}
              </h2>
              {section.body.map((paragraph) => (
                <p
                  key={paragraph}
                  className="nb-body"
                  style={{ margin: '0 0 10px', maxWidth: '72ch', lineHeight: 1.7 }}
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}

          <hr className="nb-divider" style={{ margin: '40px 0 20px' }} />
          <p style={{ margin: 0, fontSize: 13, color: 'var(--nb-ink-faint)' }}>
            {LEGAL_NAME} &middot; {SUPPORT_EMAIL}
          </p>
        </main>
      </div>
    </div>
  );
}

export default LegalPage;
