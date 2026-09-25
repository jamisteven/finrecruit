import { createServerClient as createSSRClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function getSessionClient() {
  const cookieStore = await cookies()
  return createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch { /* read-only context — fine for GET routes */ }
        },
      },
    }
  )
}
