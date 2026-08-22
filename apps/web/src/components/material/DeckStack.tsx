type Counts = {
  due: number;
  next: number;
  review: number;
};

export function DeckStack({ due, next, review }: Counts) {
  return (
    <div className="er-kraft-board p-4" data-testid="deck-stack">
      <p className="text-sm font-medium text-[var(--er-graphite)]">Today's deck</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--er-muted-ink)]">Due</dt>
          <dd className="text-2xl font-semibold" data-testid="deck-due">
            {due}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--er-muted-ink)]">New</dt>
          <dd className="text-2xl font-semibold" data-testid="deck-new">
            {next}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--er-muted-ink)]">Review</dt>
          <dd className="text-2xl font-semibold" data-testid="deck-review">
            {review}
          </dd>
        </div>
      </dl>
    </div>
  );
}
