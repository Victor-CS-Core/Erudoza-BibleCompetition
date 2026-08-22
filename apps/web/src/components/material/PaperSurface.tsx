import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  as?: "section" | "article" | "div";
  className?: string;
  "data-testid"?: string;
};

export function PaperSurface({ children, as: Tag = "section", className = "", ...rest }: Props) {
  return (
    <Tag className={`er-sheet p-5 md:p-6 ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
