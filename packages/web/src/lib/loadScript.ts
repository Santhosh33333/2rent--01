/**
 * On-demand loader for third-party browser scripts.
 *
 * These libraries were previously hard-coded in index.html, so every user paid
 * for them on every page load - including people already signed in who never
 * open a payment or Google-login screen. On a slow mobile connection that
 * competes with the app bundle for bandwidth and delays first paint.
 *
 * Each script is injected at most once, on first use, and callers await the
 * same promise afterwards.
 */

const loaded = new Map<string, Promise<void>>();

/** Load a script once; later calls resolve immediately. */
export function loadScriptOnce(src: string, id?: string): Promise<void> {
  const key = id ?? src;
  const existing = loaded.get(key);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('loadScriptOnce requires a browser environment'));
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.dataset.nabri = key;
    script.onload = () => resolve();
    script.onerror = () => {
      // Allow a later retry after a network failure.
      loaded.delete(key);
      script.remove();
      reject(new Error(`Failed to load script: ${src}`));
    };
    document.head.appendChild(script);
  });

  loaded.set(key, promise);
  return promise;
}

/** True when a script is present and has finished loading. */
export function isScriptReady(id: string): boolean {
  if (typeof document === 'undefined') return false;
  const node = document.querySelector<HTMLScriptElement>(`script[data-nabri="${id}"]`);
  return Boolean(node);
}
