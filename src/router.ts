import { useEffect, useState } from 'react'

/**
 * Client-side routing over real paths.
 *
 * The app is a single static bundle, so `vercel.json` rewrites every unknown
 * path to `index.html` and the browser hands it to us. That means each screen
 * has an address you can bookmark, share and hit Back on:
 *
 *   /                     the workspace list
 *   /w/<docId>            one workspace's canvas
 *   /settings             preferences
 *
 * Anything else is a genuine 404, and `/w/<id>` for a workspace that cannot be
 * opened sends you home rather than leaving you on a dead screen.
 */
export type Route =
  | { name: 'home' }
  | { name: 'workspace'; docId: string }
  | { name: 'settings' }
  | { name: 'not-found'; path: string }

export const HOME_PATH = '/'
export const SETTINGS_PATH = '/settings'
export const workspacePath = (docId: string): string => `/w/${encodeURIComponent(docId)}`

function parse(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return { name: 'home' }
  if (path === SETTINGS_PATH) return { name: 'settings' }

  const workspace = path.match(/^\/w\/([^/]+)$/)
  if (workspace) {
    const docId = decodeURIComponent(workspace[1])
    if (docId) return { name: 'workspace', docId }
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
