import { render, screen } from "@testing-library/react";
import { FieldGuideCover } from "./FieldGuideCover";

describe("FieldGuideCover", () => {
  it("renders the Field Guide Academy cover title", () => {
    render(
      <FieldGuideCover>
        <p>Assigned passage</p>
      </FieldGuideCover>,
    );

    expect(screen.getByTestId("field-guide-academy")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    expect(screen.getByText("Pathfinder Bible Experience")).toBeInTheDocument();
    expect(screen.getByText("Assigned passage")).toBeInTheDocument();
    expect(screen.getByTestId("field-guide-academy")).not.toHaveClass("er-field-guide-folio");
    expect(screen.queryByTestId("folio-spine")).not.toBeInTheDocument();
  });

  it("renders a folio chapter spine instead of an empty landscape banner", () => {
    render(
      <FieldGuideCover folio>
        <p>Chapter body</p>
      </FieldGuideCover>,
    );

    const cover = screen.getByTestId("field-guide-academy");
    expect(cover).toHaveClass("er-field-guide-folio");
    expect(screen.getByTestId("folio-spine")).toHaveTextContent("FIELD GUIDE");
    expect(screen.getByRole("heading", { name: "Field Guide Academy" })).toBeInTheDocument();
    expect(screen.getByText("Chapter body")).toBeInTheDocument();
  });
});
