import type { MetadataRoute } from 'next'

// Served at /robots.txt
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // keep crawlers out of the API routes (jobs data, tracking, checkout)
        disallow: ['/api/'],
      },
    ],
    sitemap: 'https://www.backchanneljobs.com/sitemap.xml',
    host: 'https://www.backchanneljobs.com',
  }
}
