/**
 * Data states for a stage.
 *
 * A marketing section whose API failed still has something true to say. This
 * component is what it says instead of the content it could not fetch - which
 * is the difference between a page that degraded and a page that looks broken.
 *
 * Every variant states what happened and, where one exists, gives a real way
 * forward: retry for a transport failure, sign in for a gated feed.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Lock, RefreshCw } from 'lucide-react';
import type { Resource } from '../hooks/useLandingContent';

interface StateBlockProps {
  resource: Pick<Resource<unknown>, 'loading' | 'error' | 'reload'>;
  /** True when the request was withheld because there is no session. */
  gated?: boolean;
  /** What was being loaded, e.g. "events near you". */
  subject: string;
  /** Copy shown when the request succeeded and returned nothing. */
  emptyBody?: ReactNode;
  /** Overrides the default signed-out copy. */
  gatedBody?: ReactNode;
}

function Skeleton() {
  return (
    <div className="nb-state nb-state--loading" aria-busy="true" aria-live="polite">
      <span className="nb-sr">Loading…</span>
      <div className="nb-skeleton" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

export function StateBlock({
  resource,
  gated = false,
  subject,
  emptyBody,
  gatedBody,
}: StateBlockProps) {
  if (resource.loading) return <Skeleton />;

  if (gated) {
    return (
      <div className="nb-state">
        <span className="nb-state-icon">
          <Lock aria-hidden="true" />
        </span>
        <p className="nb-state-title">Sign in to see this</p>
        <p className="nb-state-body">
          {gatedBody ?? `${subject} is only visible to signed-in members.`}
        </p>
      </div>
    );
  }

  if (resource.error) {
    return (
      <div className="nb-state nb-state--error" role="status">
        <span className="nb-state-icon">
          <AlertTriangle aria-hidden="true" />
        </span>
        <p className="nb-state-title">Could not load {subject}</p>
        <p className="nb-state-body">{resource.error}</p>
        <button type="button" className="nb-retry" onClick={resource.reload}>
          <RefreshCw aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }

  return (
    <div className="nb-state">
      <span className="nb-state-icon">
        <Inbox aria-hidden="true" />
      </span>
      <p className="nb-state-title">Nothing here yet</p>
      <p className="nb-state-body">
        {emptyBody ?? `There are no ${subject} published at the moment. Be the first to add one.`}
      </p>
    </div>
  );
}
