import { notFound } from 'next/navigation'
import { isAdminRequest } from '@/lib/adminAuth'
import Dashboard from './Dashboard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Analytics · BackchannelJobs', robots: { index: false, follow: false } }

export default async function AnalyticsPage() {
  const { ok } = await isAdminRequest()
  if (!ok) notFound()   // anyone else sees the ordinary 404
  return <Dashboard />
}
