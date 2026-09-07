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
  });
});
