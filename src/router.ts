import { useEffect, useState } from 'react'

/**
 * Client-side routing over real paths.
 *
 * The app is a single static bundle, so `vercel.json` rewrites every unknown
 * path to `index.html` and the browser hands it to us. That means each screen
 * has an address you can bookmark, share and hit Back on:
 *
 *   /                     the workspace list
 *   /doc/<docId>          one document's canvas
 *   /settings             preferences
 *
 * `/doc/` rather than the `/w/` this used to be, because the second kind of
 * document is coming and `w` stands for *workspace*, which is the wrong word for
 * a thing that will not be a workspace. `/w/` still works: it redirects once
 * and rewrites the address, so a link somebody already sent keeps opening the
 * document it named.
 *
 * Anything else is a genuine 404, and a document that cannot be opened sends you
 * home rather than leaving you on a dead screen.
 */
export type Route =
  | { name: 'home' }
  /**
   * `legacy` means the address in the bar is the old `/w/…` one. The document is
   * the same and the caller should not care, but the address has to be tidied —
   * otherwise the old path stays a second, permanent way to reach the same
   * document, and the two drift apart in every link anybody copies out.
   */
  | { name: 'workspace'; docId: string; legacy?: boolean }
  | { name: 'settings' }
  | { name: 'not-found'; path: string }

export const HOME_PATH = '/'
export const SETTINGS_PATH = '/settings'

/** The one address a document is known by. */
export const workspacePath = (docId: string): string => `/doc/${encodeURIComponent(docId)}`

/** The old address, kept only so old links can be sent somewhere. */
const LEGACY_WORKSPACE_PATH = /^\/w\/([^/]+)$/

/**
 * An address, as a route.
 *
 * Exported so it can be tested directly. It is a pure function of a string, and
 * a pure function of a string is the easiest thing in the app to check — which
 * matters, because the failure mode is a 404 on a link somebody already sent.
 */
export function parse(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return { name: 'home' }
  if (path === SETTINGS_PATH) return { name: 'settings' }

  const document = path.match(/^\/doc\/([^/]+)$/)
  if (document) {
    const docId = decodeURIComponent(document[1])
    if (docId) return { name: 'workspace', docId }
  }

  // An old link is not a 404. The document it names still exists, and answering
  // "not found" to a link that used to work is the kind of breakage that loses
  // somebody's notes — the page is still in the database, just unreachable.
  const legacy = path.match(LEGACY_WORKSPACE_PATH)
  if (legacy) {
    const docId = decodeURIComponent(legacy[1])
    if (docId) return { name: 'workspace', docId, legacy: true }
  }

  return { name: 'not-found', path }
}

/** Reads the current route and re-renders on Back/Forward and on `navigate`. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.pathname))

  useEffect(() => {
    const onPopState = () => setRoute(parse(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // An old `/w/…` address is tidied here rather than in the screen that renders
  // it, so the redirect happens the same way whether you arrived by typing the
  // link, clicking a bookmark, or following a message somebody sent you.
  //
  // `replace`, not `push`: a redirect that leaves a history entry means Back
  // walks you to `/w/…`, which redirects again, which walks you back. A trap.
  useEffect(() => {
    if (route.name !== 'workspace' || !route.legacy) return
    window.history.replaceState(null, '', workspacePath(route.docId))
    setRoute({ name: 'workspace', docId: route.docId })
  }, [route])

  return route
}

function go(path: string, replace = false): void {
  if (path === window.location.pathname) return
  if (replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
  // `navigate` is dispatched rather than reusing the popstate handler so the
  // in-app handlers and the browser's Back button run identical code.
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export const navigate = {
  home: () => go(HOME_PATH),
  workspace: (docId: string) => go(workspacePath(docId)),
  settings: () => go(SETTINGS_PATH),
  /** Used when a workspace will not load: replace, so Back does not return to it. */
  replace: (path: string) => go(path, true),
}

/**
 * Old bookmarks used `#workspace/<docId>`. Rather than dump those on the home
 * page, send them to the real address once and rewrite the entry, so a link
 * somebody already saved keeps working.
 */
export function migrateLegacyHash(): void {
  const { hash } = window.location
  if (!hash) return

  const workspace = hash.match(/^#workspace\/(.+)$/)
  if (workspace) {
    navigate.replace(workspacePath(decodeURIComponent(workspace[1])))
    return
  }
  if (hash === '#settings') {
    navigate.replace(SETTINGS_PATH)
  }
}
