import { IconCompass, IconHome } from '@/components/Icons'
import { HOME_PATH } from '@/router'

/**
 * Shown for a path the app does not serve. It sits inside the normal chrome, so
 * the logo, Back and the account menu all still work from here.
 */
export function NotFound({ path }: { path: string }) {
  return (
    <div className="grid h-full w-full place-items-center px-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-surface text-muted shadow-sm">
          <IconCompass size={22} />
        </div>
        <h1 className="text-lg font-semibold text-ink-strong">Nothing at this address</h1>
        <p className="mt-1 text-sm text-muted">
          <code className="cc-inline-code">{path}</code> is not a page in Map204. It may have
          been renamed, or the link may be incomplete.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <a className="cc-btn" data-variant="primary" href={HOME_PATH}>
            <IconHome size={14} /> Go to workspaces
          </a>
          <button type="button" className="cc-btn" onClick={() => window.history.back()}>
            Go back
          </button>
        </div>
      </div>
    </div>
  )
}
