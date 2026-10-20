// The mock placements each thumbnail tool draws its images in. Plain markup with no state: the tool
// (thumbnail-tool.tsx) passes each image's object URL, so nothing here loads anything from the network.
// The grey bars stand in for a listing's or video's text; no title, price or count is made up.

/** One image the visitor added, drawn from the device. Its letter is the poll option it would become. */
export type Candidate = { id: number; letter: string; name: string; src: string }

/** The crops an Etsy search grid may show a listing's first photo at (the Etsy page says why three). */
export const ETSY_CROPS = [
  { ratio: '1:1', label: 'Square (1:1)', className: 'crop-1x1' },
  { ratio: '4:3', label: 'Landscape (4:3)', className: 'crop-4x3' },
  { ratio: '5:4', label: 'Landscape (5:4)', className: 'crop-5x4' },
] as const

/** The cover heights the book cover test shows, in CSS pixels: a search result, and the hard test. */
export const COVER_HEIGHTS = [160, 80] as const
const COVER_ROWS: Record<(typeof COVER_HEIGHTS)[number], string> = {
  160: 'About 160 px tall, like a store search result',
  80: 'About 80 px tall, the hard test',
}

function TextBars() {
  return (
    <span className="text-bars" aria-hidden="true">
      <span className="text-bar" />
      <span className="text-bar short" />
    </span>
  )
}

/** One image filling a frame of the given crop (object-fit: cover), tagged for the tests and the eye. */
function Tile({ candidate, place, crop, cropClass }: { candidate: Candidate; place: string; crop: string; cropClass: string }) {
  return (
    <div className={`tile ${cropClass}`} data-tile={place} data-crop={crop} data-option={candidate.letter}>
      <img src={candidate.src} alt={`Option ${candidate.letter} (${candidate.name}) at ${crop}`} draggable={false} />
    </div>
  )
}

export function EtsyPreview({ candidates }: { candidates: Candidate[] }) {
  return (
    <div className="previews">
      {ETSY_CROPS.map((crop) => (
        <section key={crop.ratio} className="mock">
          <h2>Search grid, {crop.label.toLowerCase()}</h2>
          <div className="listing-grid">
            {candidates.map((c) => (
              <figure key={c.id} className="listing">
                <Tile candidate={c} place="etsy" crop={crop.ratio} cropClass={crop.className} />
                <figcaption>
                  <b>{c.letter}</b>
                  <TextBars />
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function CoverPreview({ candidates }: { candidates: Candidate[] }) {
  return (
    <div className="previews">
      {COVER_HEIGHTS.map((height) => (
        <section key={height} className="mock">
          <h2>{COVER_ROWS[height]}</h2>
          <div className="cover-row">
            {candidates.map((c) => (
              <figure key={c.id} className="cover">
                <img
                  className={`cover-${height}`}
                  data-tile="cover"
                  data-height={height}
                  data-option={c.letter}
                  src={c.src}
                  alt={`Option ${c.letter} (${c.name}), about ${height} px tall`}
                  draggable={false}
                />
                <figcaption>{c.letter}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function YouTubePreview({ candidates }: { candidates: Candidate[] }) {
  const card = (c: Candidate, place: string) => (
    <figure key={c.id} className="video">
      <Tile candidate={c} place={place} crop="16:9" cropClass="crop-16x9" />
      <figcaption>
        <span className="avatar" aria-hidden="true" />
        <b>{c.letter}</b>
        <TextBars />
      </figcaption>
    </figure>
  )
  return (
    <div className="previews">
      <section className="mock">
        <h2>Desktop grid</h2>
        <div className="video-grid">{candidates.map((c) => card(c, 'youtube-desktop'))}</div>
      </section>
      <section className="mock">
        <h2>Phone feed</h2>
        <div className="phone-feed">{candidates.map((c) => card(c, 'youtube-phone'))}</div>
      </section>
    </div>
  )
}
