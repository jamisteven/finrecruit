import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import Script from 'next/script'
import { Caveat, DM_Mono, DM_Sans, Fraunces, Inter, Spline_Sans_Mono } from 'next/font/google'
import './globals.css'

// Self-hosted through next/font: the files ship from our own origin with a metric-matched
// fallback, so text renders in the right size immediately and the real face swaps in without
// moving anything. The pages used to @import these from Google inside a <style> tag, which
// loaded last and shifted the whole layout once each face arrived (CLS 0.37 on the home page).
const fraunces = Fraunces({ subsets: ['latin'], weight: 'variable', axes: ['opsz'], display: 'swap', variable: '--font-fraunces' })
const inter = Inter({ subsets: ['latin'], weight: 'variable', display: 'swap', variable: '--font-inter' })
const splineMono = Spline_Sans_Mono({ subsets: ['latin'], weight: 'variable', display: 'swap', variable: '--font-spline-mono' })
const caveat = Caveat({ subsets: ['latin'], weight: 'variable', display: 'swap', variable: '--font-caveat' })
const dmSans = DM_Sans({ subsets: ['latin'], weight: 'variable', display: 'swap', variable: '--font-dm-sans' })
const dmMono = DM_Mono({ subsets: ['latin'], weight: ['400', '500'], display: 'swap', variable: '--font-dm-mono' })
const fontVars = [fraunces, inter, splineMono, caveat, dmSans, dmMono].map((f) => f.variable).join(' ')

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
    <html lang="en" className={fontVars}>
      <head>
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
      <body>
        {children}
        {/* Clarity. Our own visits are kept out with a cookie rather than Clarity's IP block, which is
            IPv4-only and misses loads that go out over IPv6: open any page with ?noclarity=1 once per
            browser (?noclarity=0 undoes it) and the tag is never loaded there again. */}
        <Script id="ms-clarity-init" strategy="afterInteractive">
          {`(function(){
            try {
              var q = new URLSearchParams(location.search).get('noclarity');
              if (q === '1') document.cookie = 'bcj_noclarity=1; max-age=31536000; path=/; samesite=lax';
              if (q === '0') document.cookie = 'bcj_noclarity=; max-age=0; path=/';
              if (/(^|; )bcj_noclarity=1/.test(document.cookie)) { console.info('[clarity] off on this browser'); return; }
            } catch (e) {}
            (function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "yr0lumcpf1");
          })();`}
        </Script>

        <Analytics />
      </body>
    </html>
  )
}
