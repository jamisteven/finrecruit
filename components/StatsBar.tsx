'use client'
import { JobPost } from '@/types'
import { Briefcase, MapPin, TrendingUp } from 'lucide-react'

export function StatsBar({ jobs }: { jobs: JobPost[] }) {
  const locations = [...new Set(jobs.map((j) => j.location).filter(Boolean))].length
  const companies = [...new Set(jobs.map((j) => j.company).filter(Boolean))].length
  const newToday = jobs.filter((j) => {
    if (!j.extracted_at) return false
    const d = new Date(j.extracted_at)
    const now = new Date()
    return now.getTime() - d.getTime() < 86_400_000
  }).length

  const stats = [
    { icon: Briefcase, label: 'Total Roles', value: jobs.length },
    { icon: TrendingUp, label: 'Added Today', value: newToday },
    { icon: MapPin, label: 'Locations', value: locations },
  ]

  return (
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      {stats.map(({ icon: Icon, label, value }) => (
        <div key={label} style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flex: '1 1 120px',
        }}>
          <div style={{
            width: '32px', height: '32px',
            background: 'var(--gold-glow)',
            borderRadius: '6px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={15} style={{ color: 'var(--gold)' }} />
          </div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1 }}>
              {value}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {label}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
