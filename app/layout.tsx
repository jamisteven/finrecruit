import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BackchannelJobs — Hidden Jobs from LinkedIn',
  description: 'Surface jobs posted by recruiters on LinkedIn that never make it to job boards. Finance, Tech, Legal, Marketing.',
  openGraph: {
    title: "BackchannelJobs — The jobs LinkedIn doesn't show you",
    description: 'Roles recruiters post in the feed and never list — pulled from public posts, classified by AI, refreshed twice a day.',
    url: 'https://backchanneljobs.com',
    siteName: 'BackchannelJobs',
    images: [{ url: '/og', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "BackchannelJobs — The jobs LinkedIn doesn't show you",
    description: 'Roles recruiters post in the feed and never list — pulled from public posts, classified by AI, refreshed twice a day.',
    images: ['/og'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
