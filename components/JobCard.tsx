'use client'
import { JobPost } from '@/types'
import { MapPin, Building2, Clock, ExternalLink, DollarSign } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const SENIORITY_COLORS: Record<string, string> = {
  Intern: '#64748b', Junior: '#3b82f6', Mid: '#8b5cf6', Senior: '#f59e0b',
  VP: '#ef4444', Director: '#ef4444', MD: '#C4A769', Partner: '#C4A769',
  'C-Suite': '#C4A769', Unknown: '#4A5568',
}

// Generate a deterministic avatar color from author name
function avatarColor(name: string): string {
  const colors = ['#3B9EEB', '#8b5cf6', '#f59e0b', '#2ECC71', '#C4A769', '#ef4444', '#ec4899']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
}

interface Props { job: JobPost; index: number; darkMode: boolean }

export function JobCard({ job, index, darkMode }: Props) {
  const color = SENIORITY_COLORS[job.seniority] || '#4A5568'
  const timeAgo = job.extracted_at
    ? formatDistanceToNow(new Date(job.extracted_at), { addSuffix: true })
    : null

  const cardBg = darkMode ? 'var(--bg-primary)' : '#ffffff'
  const cardBorder = darkMode ? 'var(--border)' : '#e5e7eb'

  return (
    <div
      className="job-card fade-up"
      style={{
        animationDelay: `${Math.min(index * 40, 400)}ms`,
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        borderRadius: '8px', padding: '20px 24px',
        display: 'flex', flexDirection: 'column', gap: '12px',
        cursor: 'pointer',
      }}
      onClick={() => window.open(job.post_url, '_blank')}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <span style={{
              fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: color, background: `${color}18`, border: `1px solid ${color}40`,
              padding: '2px 7px', borderRadius: '3px', fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap',
            }}>{job.seniority}</span>
            {timeAgo && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={10} />{timeAgo}
              </span>
            )}
          </div>

          <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: '2px' }}>
            {job.title || 'Untitled Role'}
          </h3>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '6px' }}>
            {job.company && (
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Building2 size={11} style={{ color: 'var(--gold-dim)' }} />{job.company}
              </span>
            )}
            {job.location && (
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <MapPin size={11} style={{ color: 'var(--gold-dim)' }} />{job.location}
              </span>
            )}
            {job.salary && (
              <span style={{ fontSize: '12px', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <DollarSign size={11} />{job.salary}
              </span>
            )}
          </div>
        </div>
        <ExternalLink size={14} style={{ color: 'var(--text-muted)', marginTop: '2px', flexShrink: 0 }} />
      </div>

      {/* Summary */}
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        {job.summary}
      </p>

      {/* Tags */}
      {job.tags?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {job.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </div>
      )}

      {/* Author row with avatar */}
      {job.author_name && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Avatar */}
            {job.author_linkedin_url && job.author_linkedin_url !== '#' ? (
              <img
                src={`https://unavatar.io/linkedin/${job.author_linkedin_url.split('/in/')[1]?.split('?')[0]}`}
                alt={job.author_name}
                onError={(e) => {
                  // Fall back to initials on error
                  const el = e.currentTarget
                  el.style.display = 'none'
                  const next = el.nextSibling as HTMLElement
                  if (next) next.style.display = 'flex'
                }}
                style={{
                  width: '24px', height: '24px', borderRadius: '50%',
                  objectFit: 'cover', flexShrink: 0,
                }}
              />
            ) : null}
            {/* Fallback initials avatar */}
            <div style={{
              width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0,
              background: avatarColor(job.author_name),
              display: job.author_linkedin_url && job.author_linkedin_url !== '#' ? 'none' : 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: '9px', fontWeight: 700, color: '#fff',
            }}>
              {initials(job.author_name)}
            </div>

            <div>
              <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                {job.author_name}
              </div>
              {job.author_headline && (
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {job.author_headline}
                </div>
              )}
            </div>
          </div>

          {/* Apply method */}
          {job.apply_method && (
            <div style={{
              fontSize: '11px', color: 'var(--gold)', background: 'var(--gold-glow)',
              border: '1px solid rgba(196,167,105,0.2)', borderRadius: '4px',
              padding: '5px 10px', display: 'inline-flex', alignItems: 'center', gap: '5px',
            }}>
              → {job.apply_method}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
