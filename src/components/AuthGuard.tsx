import { useEffect, useState } from 'react'

import { LoginPage } from '@/components/LoginPage'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { SupabaseUser } from '@/lib/supabase'

interface AuthGuardProps {
  children: React.ReactNode
  onUserChange?: (user: SupabaseUser | null) => void
}

export function AuthGuard({ children, onUserChange }: AuthGuardProps) {
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      console.error('[AuthGuard] Supabase not configured')
      setLoading(false)
      return
    }

    supabase!.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        const u = {
          id: data.session.user.id,
          email: data.session.user.email ?? '',
          user_metadata: data.session.user.user_metadata,
        }
        setUser(u)
        onUserChange?.(u)
      }
      setLoading(false)
    })

    const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const u = {
          id: session.user.id,
          email: session.user.email ?? '',
          user_metadata: session.user.user_metadata,
        }
        setUser(u)
        onUserChange?.(u)
      } else {
        setUser(null)
        onUserChange?.(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [onUserChange])

  // If Supabase is not configured, show error.
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-canvas">
        <div className="cc-panel max-w-sm p-6 text-center">
          <h2 className="mb-2 text-lg font-bold text-slate-700">Configuration Error</h2>
          <p className="text-sm text-slate-500">
            Supabase is not configured. Add{' '}
            <code className="cc-inline-code">VITE_SUPABASE_URL</code> and{' '}
            <code className="cc-inline-code">VITE_SUPABASE_ANON_KEY</code> to your
            environment variables and redeploy.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-canvas">
        <div className="text-sm text-slate-400">Loading…</div>
      </div>
    )
  }

  if (!user) {
    return <LoginPage onAuth={setUser} />
  }

  return <>{children}</>
}
