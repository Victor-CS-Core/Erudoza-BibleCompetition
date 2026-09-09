import { ACADEMY_DECK_ART } from "../brand/academyDeckArt";

type Counts = {
  learner: number;
  reviews: number;
  seasonStatus?: string | null;
};

export function DeckStack({ learner, reviews, seasonStatus }: Counts) {
  const values = {
    learner: String(learner),
    reviews: String(reviews),
    rehearsal: seasonStatus || "—",
  };

  return (
    <div className="er-kraft-board er-deck-art p-4" data-testid="deck-stack">
      <p className="text-sm font-medium text-[var(--er-graphite)]">Today's deck</p>
      <div className="er-deck-art-row">
        {ACADEMY_DECK_ART.map((deck) => (
          <article
            key={deck.id}
            className={`er-deck-art-card er-deck-art-card-${deck.id}`}
            data-testid={`deck-card-${deck.id}`}
          >
            <img className="er-deck-art-face" src={deck.src} alt={`${deck.label} deck`} />
            <p className="er-deck-art-ribbon">{deck.label}</p>
            <p className="er-deck-art-count" data-testid={`deck-${deck.id}`}>
              {values[deck.id]}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
