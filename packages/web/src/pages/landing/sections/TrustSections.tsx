/**
 * The download / offer section, and the trust row above the footer.
 *
 * ## The offer number is read, not written
 *
 * The reference design hardcoded `"7 DAYS FREE"` into its config object. The
 * seeded plans in `prisma/seed-subscriptions.ts` both carry `trialDays: 1`,
 * and `GET /subscriptions/plans` is mounted before `authenticateToken` so an
 * anonymous visitor can read it. So the headline is built from that value:
 *
 *   trialDays === 1 -> "1 DAY FREE"
 *   trialDays === 7 -> "7 DAYS FREE"
 *
 * Today it renders one day, because one day is what the database says. If an
 * admin changes a plan's trial in `/admin/pricing`, this page follows with no
 * code change and no chance of the two disagreeing.
 *
 * ## The store buttons are honest about what exists
 *
 * `C.appStoreUrl` and `C.googlePlayUrl` were both empty strings in the
 * reference, and it rendered App Store and Google Play badges anyway - two
 * links that go nowhere, dressed as the primary conversion on the page. Nabri
 * ships an Android APK, so that is the only download offered, and the badge
 * says APK. The APK is copied into `dist/download/` by a Vite plugin at the
 * end of every build, which is the path the button points at.
 */
import { Link } from 'react-router-dom';
import { ArrowRight, Download, ShieldCheck, Sparkles, Store, Users, Wallet } from 'lucide-react';
import { Backdrop } from '../components/Backdrop';
import { Brand } from '../components/SiteChrome';
import { formatPlanPrice, type Plan, type Resource } from '../hooks/useLandingContent';

/** "1 DAY FREE" / "7 DAYS FREE" - never a hand-written marketing number. */
export function trialHeadline(days: number): string | null {
  if (days <= 0) return null;
  return `${days} DAY${days === 1 ? '' : 'S'} FREE`;
}

interface DownloadProps {
  plans: Resource<{ plans: Plan[] }>;
  signedIn: boolean;
}

export function DownloadSection({ plans, signedIn }: DownloadProps) {
  const list = plans.data?.plans ?? [];
  // The headline comes from the plan with the longest trial, so it is the best
  // the visitor can actually get rather than whichever row happened to be first.
  const trialDays = list.reduce((max, plan) => Math.max(max, plan.trialDays), 0);
  const headline = trialHeadline(trialDays);
  const cheapest = [...list].sort((a, b) => a.price - b.price)[0] ?? null;

  return (
    <section className="nb-section nb-cta" id="download" aria-labelledby="nb-cta-h">
      <Backdrop scene="cta" gradientOnly />
      <div className="nb-veil nb-veil--cta" />

      <div className="nb-wrap">
        <div className="nb-rv">
          <Brand size={56} />

          <h2 id="nb-cta-h">Ready to find your people?</h2>
          <p>
            {signedIn
              ? 'Your account is ready. The app has everything the web app does, plus notifications.'
              : 'Create an account in a minute, or install the app and sign in there.'}
          </p>

          <div className="nb-btns" style={{ justifyContent: 'center' }}>
            <a className="nb-btn nb-btn--lg" href="/download/nabri.apk" download>
              <Download aria-hidden="true" /> Download the Android app
            </a>
            {signedIn ? (
              <Link className="nb-btn nb-btn--ghost nb-btn--lg" to="/home">
                Open Nabri <ArrowRight aria-hidden="true" />
              </Link>
            ) : (
              <Link className="nb-btn nb-btn--ghost nb-btn--lg" to="/register">
                Create an account <ArrowRight aria-hidden="true" />
              </Link>
            )}
          </div>

          {headline ? (
            <>
              <span className="nb-cta-offer">{headline}</span>
              <span className="nb-state-body" style={{ display: 'block', marginTop: 8 }}>
                {trialDays === 1
                  ? 'One free day on every plan, then billing starts.'
                  : `${trialDays} free days on every plan, then billing starts.`}
                {cheapest ? ` Plans start at ${formatPlanPrice(cheapest)}.` : ''}
              </span>
            </>
          ) : (
            <span className="nb-state-body" style={{ display: 'block' }}>
              {plans.loading
                ? 'Checking current plans…'
                : plans.error
                  ? 'Plan details are unavailable right now.'
                  : 'No paid plans are published at the moment.'}
            </span>
          )}

          {/* Only real destinations. The reference offered App Store and Google
              Play badges whose URLs were empty strings. */}
          <div className="nb-stores">
            <a className="nb-store" href="/download/nabri.apk" download>
              <Store aria-hidden="true" />
              <span>
                Android APK
                <strong>Direct download</strong>
              </span>
            </a>
            <Link className="nb-store" to="/account-type">
              <Download aria-hidden="true" />
              <span>
                Prefer a browser?
                <strong>Use the web app</strong>
              </span>
            </Link>
          </div>

          <p className="nb-hand nb-script" aria-hidden="true">
            <span style={{ display: 'block' }}>More than an app</span>
            <span style={{ display: 'block' }}>it&apos;s what&apos;s nearby</span>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Trust                                                               */
/* ------------------------------------------------------------------ */

/**
 * The four commitments.
 *
 * Each maps to something the codebase actually does rather than to an
 * aspiration: there is a six-step KYC route, a six-role role system, a
 * neighbourhood-level location policy enforced in the public controllers, and
 * a Cashfree-backed wallet with a real withdrawal flow. A trust row of
 * adjectives ("Safe & Verified", "Real People") says nothing; this one names
 * the mechanism.
 */
const TRUST = [
  {
    icon: ShieldCheck,
    title: 'Six-step verification',
    body: 'Personal details, government ID, a live selfie, address proof, an emergency contact and a review. No shortcuts.',
  },
  {
    icon: Users,
    title: 'Accounts, not profiles',
    body: 'Dating and community require a signed-in, verified account. Distance is shown as a band, never an address.',
  },
  {
    icon: Wallet,
    title: 'Money through the wallet',
    body: 'Wallet balances, transactions and withdrawals are all in the app. Partner payouts go through the same ledger.',
  },
  {
    icon: Sparkles,
    title: 'Moderated, not ignored',
    body: 'Reports, SOS and a support queue are built in. Disputes end with a person, not an automated refund.',
  },
] as const;

export function TrustSection() {
  return (
    <section className="nb-section" aria-labelledby="nb-trust-h">
      <div className="nb-wrap" style={{ padding: '80px 24px' }}>
        <h2 id="nb-trust-h" className="nb-sr">
          How Nabri keeps it safe
        </h2>
        <div
          style={{
            display: 'grid',
            gap: 24,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 15rem), 1fr))',
          }}
        >
          {TRUST.map((item) => (
            <div key={item.title} className="nb-rv">
              <span className="nb-cap-icon" style={{ marginBottom: 12 }}>
                <item.icon aria-hidden="true" />
              </span>
              <h3 style={{ margin: '0 0 6px', fontSize: 17 }}>{item.title}</h3>
              <p style={{ margin: 0, color: 'var(--nb-copy)', fontSize: 14 }}>{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
