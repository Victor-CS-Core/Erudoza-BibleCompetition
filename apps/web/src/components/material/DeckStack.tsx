type Counts = {
  learner: number;
  reviews: number;
  seasonStatus?: string | null;
};

export function DeckStack({ learner, reviews, seasonStatus }: Counts) {
  return (
    <div className="er-kraft-board p-4" data-testid="deck-stack">
      <p className="text-sm font-medium text-[var(--er-graphite)]">Today's deck</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--er-muted-ink)]">Learner</dt>
          <dd className="text-2xl font-semibold" data-testid="deck-learner">
            {learner}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--er-muted-ink)]">Reviews</dt>
          <dd className="text-2xl font-semibold" data-testid="deck-reviews">
            {reviews}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--er-muted-ink)]">Rehearsal</dt>
          <dd className="text-2xl font-semibold" data-testid="deck-rehearsal">
            {seasonStatus || "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
