import type { ReactNode } from "react";

type Props = {
  children?: ReactNode;
  stamp?: ReactNode;
};

export function FieldGuideCover({ children, stamp }: Props) {
  return (
    <section className="er-field-guide" data-testid="field-guide-academy">
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
