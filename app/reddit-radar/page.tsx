import { notFound } from 'next/navigation'
import { isAdminRequest } from '@/lib/adminAuth'
import RadarClient from './RadarClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reddit radar · BackchannelJobs', robots: { index: false, follow: false } }

export default async function RedditRadarPage() {
  const { ok } = await isAdminRequest()
  if (!ok) notFound()   // anyone else sees the ordinary 404
  return <RadarClient />
}
