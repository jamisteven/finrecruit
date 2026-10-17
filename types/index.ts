export type Seniority = 'Intern' | 'Junior' | 'Mid' | 'Senior' | 'VP' | 'Director' | 'MD' | 'Partner' | 'C-Suite' | 'Unknown'
export type Sector = 'all' | 'finance' | 'tech' | 'legal' | 'marketing' | 'realestate' | 'sales' | 'hr'
export type WorkType = 'Remote' | 'On-site' | 'Hybrid'

export type JobPost = {
  id: string
  title: string
  company: string | null
  location: string | null
  seniority: Seniority
  salary: string | null
  apply_method: string | null
  summary: string
  tags: string[]
  sector: string
  post_url: string
  repost_count?: number   // other posts of this same role folded into this one
  author_name: string | null
  author_headline: string | null
  author_avatar?: string | null
  author_linkedin_url: string | null
  raw_text: string
  posted_at: string | null
  extracted_at: string
  is_verified_job: boolean
  quality?: string | null
  work_type?: WorkType | null
}

export type FilterState = {
  sector: Sector
  seniority: Seniority | 'All'
  locations: string[]
  workTypes: WorkType[]
  search: string
  sortBy: 'newest' | 'oldest'
}

export type IngestResult = {
  sector: string
  total: number
  classified_as_jobs: number
  duplicates_skipped: number
  inserted: number
  errors: number
}
