type Counts = {
  learner: number;
  reviews: number;
  seasonStatus?: string | null;
};

const decks = [
  { id: "learner", label: "Learner" },
  { id: "reviews", label: "Reviews" },
  { id: "rehearsal", label: "Rehearsal" },
] as const;

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
        {decks.map((deck) => (
          <article
            key={deck.id}
            className={`er-deck-art-card er-deck-art-card-${deck.id}`}
            data-testid={`deck-card-${deck.id}`}
          >
            <span className="er-deck-art-mark" aria-hidden="true">
              <DeckMark id={deck.id} />
            </span>
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

function DeckMark({ id }: { id: (typeof decks)[number]["id"] }) {
  if (id === "reviews") {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18">
        <path fill="currentColor" d="M12 3 14.2 9.2 21 10l-5 4.2L17.4 21 12 17.8 6.6 21 8 14.2 3 10l6.8-.8Z" />
      </svg>
    );
  }
  if (id === "rehearsal") {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18">
        <path
          fill="currentColor"
          d="M7 20c2-6 3-10 8-16-1 6 1 9 4 12-5 1-8 1-12 4Z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path fill="currentColor" d="M12 5 13.2 11 19 12 13.2 13 12 19 10.8 13 5 12 10.8 11Z" />
    </svg>
  );
}
