import { getSessionClient } from './supabase-session'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'jamisteven@gmail.com')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

/** Is the signed-in user one of the site's admins? Never throws. */
export async function isAdminRequest(): Promise<{ ok: boolean; email: string | null }> {
  try {
    const { data: { user } } = await (await getSessionClient()).auth.getUser()
    const email = user?.email?.toLowerCase() ?? null
    return { ok: !!email && ADMIN_EMAILS.includes(email), email }
  } catch { return { ok: false, email: null } }
}
