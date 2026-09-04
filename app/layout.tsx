import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BackchannelJobs — Jobs Recruiters Post on LinkedIn',
  description: 'Find jobs that recruiters post directly on LinkedIn — not in the jobs section. Finance, Tech, Legal, Marketing roles updated twice daily. See what others miss.',
  keywords: ['linkedin recruiter jobs', 'hidden jobs linkedin', 'recruiter posts linkedin', 'jobs not on job boards', 'linkedin hiring posts', 'finance recruiter jobs', 'tech recruiter jobs', 'hidden job market'],
  metadataBase: new URL('https://www.backchanneljobs.com'),
  alternates: {
    canonical: 'https://www.backchanneljobs.com',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-new.ico' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: "BackchannelJobs — The jobs LinkedIn doesn't show you",
    description: 'Roles recruiters post in the feed and never list — pulled from public posts, classified by AI, refreshed twice a day.',
    url: 'https://www.backchanneljobs.com',
    siteName: 'BackchannelJobs',
    images: [{ url: 'https://www.backchanneljobs.com/og', width: 1200, height: 630, alt: 'BackchannelJobs — Hidden Jobs from LinkedIn' }],
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: "BackchannelJobs — The jobs LinkedIn doesn't show you",
    description: 'Roles recruiters post in the feed and never list — pulled from public posts, classified by AI, refreshed twice a day.',
    images: ['https://www.backchanneljobs.com/og'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              "name": "BackchannelJobs",
              "url": "https://www.backchanneljobs.com",
              "description": "Jobs that recruiters post on LinkedIn that never make it to job boards.",
              "potentialAction": {
                "@type": "SearchAction",
                "target": "https://www.backchanneljobs.com/?search={search_term_string}",
                "query-input": "required name=search_term_string"
              }
            })
          }}
        />
      <script async src="https://www.googletagmanager.com/gtag/js?id=G-FH3R4GG8HX"></script>
        <script dangerouslySetInnerHTML={{ __html: `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-FH3R4GG8HX');
        `}} />
      </head>
      <body>{children}</body>
    </html>
  )
}
