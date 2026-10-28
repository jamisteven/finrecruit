'use client'

import { citiesIn, canonPlace } from '@/lib/widenLocation'

const cap = (x: string) => x.replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase())

/**
 * Shown when a place is wider than a city (a country, a state). Recruiters name the city, so a country-wide search
 * misses posts a city search finds. Uses the same label + pill markup as the "roles we also carry" suggestions, so it
 * picks up each page's own .chips-wrap / .chips-label / .chip / .link-btn styles.
 */
export default function BroadPlaceNudge({ place, taken, onPick, onRemoteOnly }: {
  place: string
  taken: string[]                       // cities already chosen
  onPick: (city: string) => void
  onRemoteOnly?: () => void             // offered while nothing else is chosen
}) {
  const cities = citiesIn(place).filter((c) => !taken.some((x) => canonPlace(x) === canonPlace(c))).slice(0, 4)
  return (
    <div className="chips-wrap">
      <p className="chips-label">
        {cap(place)} covers a lot of ground, and recruiters name a city in their posts.{' '}
        {cities.length ? 'Pick the cities you would work in:' : 'Type the city you would work in above.'}
      </p>
      {cities.length > 0 && (
        <div className="chips">
          {cities.map((c) => <button type="button" className="chip" key={c} onClick={() => onPick(c)}>+ {c}</button>)}
        </div>
      )}
      {onRemoteOnly && (
        <button type="button" className="link-btn" onClick={onRemoteOnly}>Remote roles only instead</button>
      )}
    </div>
  )
}
