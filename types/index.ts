export type Seniority = 'Intern' | 'Junior' | 'Mid' | 'Senior' | 'VP' | 'Director' | 'MD' | 'Partner' | 'C-Suite' | 'Unknown'

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
  post_url: string
  author_name: string | null
  author_headline: string | null
  author_linkedin_url: string | null
  raw_text: string
  posted_at: string | null
  extracted_at: string
  is_verified_job: boolean
}

export type FilterState = {
  seniority: Seniority | 'All'
  location: string
  search: string
  sortBy: 'newest' | 'oldest'
}

export type IngestResult = {
  total: number
  classified_as_jobs: number
  duplicates_skipped: number
  inserted: number
  errors: number
}
