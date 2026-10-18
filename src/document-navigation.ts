type OpenDocument = (url: URL) => Promise<void>;
let openDocument: OpenDocument | undefined;
let switching = false;
let loadedURL = typeof location === 'undefined' ? '' : location.href;
if (typeof window !== 'undefined') window.addEventListener('popstate', () => {
  const target = new URL(location.href);
  if (!openDocument) return;
  if (switching) { history.replaceState(null, '', loadedURL); return; }
  switching = true;
  const wasInert = document.body.inert; document.body.inert = true;
  void openDocument(target).then(() => {
    loadedURL = target.href;
    history.replaceState(null, '', target);
    window.dispatchEvent(new Event('cad-document-navigation'));
  }).catch(error => {
    history.replaceState(null, '', loadedURL);
    window.dispatchEvent(new CustomEvent('cad-document-navigation-error', {detail: String(error)}));
  }).finally(() => { switching = false; document.body.inert = wasInert; });
});
export function configureDocumentNavigation(open: OpenDocument) { openDocument = open; loadedURL = location.href; }
/** Keep the shell mounted. Refuse competing switches rather than racing autosave. */
export async function navigateDocument(href: string): Promise<void> {
  const url = new URL(href, location.href);
  if (new URL(location.href).searchParams.has("isolated")) url.searchParams.set("isolated", "1");
  if (url.href === location.href) return;
  if (switching) throw new Error('Wait for the current tab to finish opening.');
  if (url.origin !== location.origin || url.pathname !== '/cad/index.html' || !openDocument) {
    location.assign(url.href); return;
  }
  switching = true;
  const wasInert = document.body.inert; document.body.inert = true;
  try { await openDocument(url); history.pushState(null, '', url); loadedURL = url.href; window.dispatchEvent(new Event('cad-document-navigation')); }
  finally { switching = false; document.body.inert = wasInert; }
}
