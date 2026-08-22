import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

export function StudyCard({ children, className = "" }: Props) {
  return (
    <article className={`er-study-card p-6 md:p-8 ${className}`} data-testid="challenge-card">
      {children}
    </article>
  );
}
