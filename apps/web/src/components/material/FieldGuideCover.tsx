import type { ReactNode } from "react";

type Props = {
  children?: ReactNode;
  stamp?: ReactNode;
  folio?: boolean;
};

export function FieldGuideCover({ children, stamp, folio }: Props) {
  return (
    <section
      className={folio ? "er-field-guide er-field-guide-folio" : "er-field-guide"}
      data-testid="field-guide-academy"
    >
      {folio ? (
        <span className="er-field-guide-spine" data-testid="folio-spine">
          FIELD GUIDE
        </span>
      ) : null}
      <div className="er-field-guide-inner">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="er-eyebrow">Pathfinder Bible Experience</p>
            <h1 className="mt-2 font-serif text-2xl font-semibold tracking-tight">Field Guide Academy</h1>
          </div>
          {stamp}
        </div>
        {children}
      </div>
    </section>
  );
}
