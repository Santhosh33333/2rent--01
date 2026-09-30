/**
 * Cookie / privacy consent.
 *
 * Stores a versioned record so a future change to the categories invalidates
 * old consent instead of silently inheriting it. "Necessary" cannot be switched
 * off because the session and the consent record itself depend on it.
 *
 * Nothing is loaded from a third party here yet, so declining genuinely results
 * in no optional storage. If analytics or marketing tags are added later, they
 * must be gated on this state rather than hardcoded into the layout.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';

export type ConsentCategory = 'necessary' | 'analytics' | 'functional' | 'marketing';

export interface ConsentRecord {
  version: number;
  decidedAt: string;
  categories: Record<ConsentCategory, boolean>;
}

const STORAGE_KEY = 'nabri.consent';
/** Bump when the category meanings change so old consent is re-asked. */
const CONSENT_VERSION = 1;

const CATEGORY_COPY: Array<{
  id: ConsentCategory;
  label: string;
  description: string;
  locked?: boolean;
}> = [
  {
    id: 'necessary',
    label: 'Necessary',
    description:
      'Required for sign-in, security and remembering this consent choice. Always on.',
    locked: true,
  },
  {
    id: 'functional',
    label: 'Functional',
    description: 'Remembers preferences such as language and theme.',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    description: 'Helps us understand which pages are used so we can improve them.',
  },
  {
    id: 'marketing',
    label: 'Marketing',
    description: 'Used to measure campaigns. Off unless you opt in.',
  },
];

function readStoredConsent(): ConsentRecord | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentRecord;
    if (!parsed || parsed.version !== CONSENT_VERSION || !parsed.categories) return null;
    return parsed;
  } catch {
    // Corrupt or unavailable storage should never break the page.
    return null;
  }
}

function writeConsent(categories: Record<ConsentCategory, boolean>): ConsentRecord {
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    decidedAt: new Date().toISOString(),
    categories: { ...categories, necessary: true },
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* private browsing: the choice applies for this page view only */
  }
  window.dispatchEvent(new CustomEvent('nabri:consent-changed', { detail: record }));
  return record;
}

export function useConsent() {
  const [record, setRecord] = useState<ConsentRecord | null>(null);
  const [decided, setDecided] = useState(true);

  useEffect(() => {
    const stored = readStoredConsent();
    setRecord(stored);
    setDecided(stored !== null);

    // The footer's "cookie settings" link can reopen the panel later.
    const onOpen = () => setDecided(false);
    window.addEventListener('nabri:open-consent', onOpen);
    return () => window.removeEventListener('nabri:open-consent', onOpen);
  }, []);

  /** Persist a decision and mark the session as decided in one step. */
  const decide = useCallback((categories: Record<ConsentCategory, boolean>) => {
    setRecord(writeConsent(categories));
    setDecided(true);
  }, []);

  return { record, decided, decide, reopen: () => setDecided(false) };
}

export function CookieConsent() {
  const { decided, decide } = useConsent();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Record<ConsentCategory, boolean>>({
    necessary: true,
    functional: false,
    analytics: false,
    marketing: false,
  });

  useEffect(() => {
    if (decided) return;
    // Delay so the panel does not compete with the hero on first paint.
    const timer = window.setTimeout(() => setOpen(true), 900);
    return () => window.clearTimeout(timer);
  }, [decided]);

  const acceptAll = useCallback(() => {
    decide({ necessary: true, functional: true, analytics: true, marketing: true });
    setOpen(false);
  }, [decide]);

  const rejectOptional = useCallback(() => {
    decide({ necessary: true, functional: false, analytics: false, marketing: false });
    setOpen(false);
  }, [decide]);

  const savePreferences = useCallback(() => {
    decide({ ...prefs, necessary: true });
    setOpen(false);
  }, [decide, prefs]);

  if (decided && !open) return null;

  return (
    <>
      {open && !decided && (
        <div
          className="nb-cookie"
          role="region"
          aria-label="Cookie and privacy preferences"
        >
          <div
            className="nb-container"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}
          >
            <p
              className="nb-body"
              style={{ margin: 0, flex: '1 1 420px', fontSize: 14, color: 'var(--nb-ink-soft)' }}
            >
              We value your privacy. Nabri and its service providers may use cookies and
              similar technologies to provide, secure and improve our website. You can
              manage your choices at any time.{' '}
              {/* Pointed at /cookies, which had no route, so a visitor who
                  followed the cookie policy link landed on a blank page. The
                  data section of the public legal page covers what we store. */}
              <Link to="/legal#data" style={{ color: 'var(--nb-blue)' }}>
                Read the cookie policy
              </Link>
              .
            </p>
            <div className="nb-cookie__actions">
              <button
                type="button"
                className="nb-btn nb-btn--secondary nb-btn--sm"
                onClick={() => setOpen(true)}
              >
                Personalize Choices
              </button>
              <button
                type="button"
                className="nb-btn nb-btn--primary nb-btn--sm"
                onClick={acceptAll}
              >
                Accept
              </button>
              <button
                type="button"
                className="nb-btn nb-btn--ghost nb-btn--sm"
                onClick={rejectOptional}
              >
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div
          className="nb-modal__backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            className="nb-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nb-prefs-title"
            style={{ padding: 24 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <h2 id="nb-prefs-title" className="nb-h3" style={{ margin: 0, fontSize: 20 }}>
                  Privacy preferences
                </h2>
                <p className="nb-body" style={{ margin: '6px 0 0', fontSize: 14 }}>
                  Choose which categories Nabri may use on this device.
                </p>
              </div>
              <button
                type="button"
                className="nb-btn nb-btn--ghost"
                style={{ minHeight: 36, padding: 6, width: 36 }}
                aria-label="Close preferences"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <ul style={{ listStyle: 'none', margin: '20px 0 0', padding: 0 }}>
              {CATEGORY_COPY.map((category) => (
                <li
                  key={category.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 14,
                    padding: '14px 0',
                    borderTop: '1px solid var(--nb-line)',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 650, fontSize: 15 }}>{category.label}</div>
                    <div style={{ fontSize: 13, color: 'var(--nb-ink-soft)', marginTop: 2 }}>
                      {category.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={prefs[category.id]}
                    aria-label={category.label}
                    disabled={category.locked}
                    className="nb-switch"
                    style={{ marginTop: 2 }}
                    onClick={() =>
                      setPrefs((current) => ({
                        ...current,
                        [category.id]: !current[category.id],
                      }))
                    }
                  />
                </li>
              ))}
            </ul>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20 }}>
              <button type="button" className="nb-btn nb-btn--primary" onClick={acceptAll}>
                Accept All
              </button>
              <button type="button" className="nb-btn nb-btn--secondary" onClick={rejectOptional}>
                Reject Optional
              </button>
              <button type="button" className="nb-btn nb-btn--ghost" onClick={savePreferences}>
                Save Preferences
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
