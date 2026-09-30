/**
 * Per-page metadata for a single-page app.
 *
 * The document head is not reactive, so a client-side route change would
 * otherwise leave the previous page's title and description in place, which is
 * what search engines and link previews read. These helpers keep the head in
 * sync with the route and clean up tags this module created.
 *
 * Only tags this module owns are touched. Anything authored directly in
 * index.html is left alone.
 */

const MANAGED = 'data-nb-seo';

function upsertMeta(selector: string, create: () => HTMLMetaElement, apply: (el: HTMLMetaElement) => void) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = create();
    el.setAttribute(MANAGED, '');
    document.head.appendChild(el);
  }
  apply(el);
}

export interface PageMeta {
  title: string;
  description: string;
  /** Absolute or root-relative image for link previews. */
  image?: string;
  /** Path only, e.g. '/events'. */
  canonicalPath?: string;
}

export function setPageMeta({ title, description, image, canonicalPath }: PageMeta): void {
  document.title = title;

  upsertMeta('meta[name="description"]', () => {
    const el = document.createElement('meta');
    el.setAttribute('name', 'description');
    return el;
  }, (el) => el.setAttribute('content', description));

  upsertMeta('meta[property="og:title"]', () => {
    const el = document.createElement('meta');
    el.setAttribute('property', 'og:title');
    return el;
  }, (el) => el.setAttribute('content', title));

  upsertMeta('meta[property="og:description"]', () => {
    const el = document.createElement('meta');
    el.setAttribute('property', 'og:description');
    return el;
  }, (el) => el.setAttribute('content', description));

  upsertMeta('meta[name="twitter:card"]', () => {
    const el = document.createElement('meta');
    el.setAttribute('name', 'twitter:card');
    return el;
  }, (el) => el.setAttribute('content', 'summary_large_image'));

  upsertMeta('meta[name="twitter:title"]', () => {
    const el = document.createElement('meta');
    el.setAttribute('name', 'twitter:title');
    return el;
  }, (el) => el.setAttribute('content', title));

  upsertMeta('meta[name="twitter:description"]', () => {
    const el = document.createElement('meta');
    el.setAttribute('name', 'twitter:description');
    return el;
  }, (el) => el.setAttribute('content', description));

  if (image) {
    upsertMeta('meta[property="og:image"]', () => {
      const el = document.createElement('meta');
      el.setAttribute('property', 'og:image');
      return el;
    }, (el) => el.setAttribute('content', image));
  }

  if (canonicalPath) {
    let link = document.head.querySelector<HTMLLinkElement>(`link[rel="canonical"]`);
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      link.setAttribute(MANAGED, '');
      document.head.appendChild(link);
    }
    link.setAttribute('href', new URL(canonicalPath, window.location.origin).toString());
  }
}
