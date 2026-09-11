import { render, fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AppealForm } from "./AppealForm";
it("requires a reason and sends trimmed text for coach review", () => {
  const request = vi.fn();
  render(<AppealForm pending={false} onRequest={request} />);
  expect(screen.getByRole("button", { name: "Request coach review" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Reason for review"), { target: { value: "  The accepted wording matches our source.  " } });
  fireEvent.click(screen.getByRole("button", { name: "Request coach review" }));
  expect(request).toHaveBeenCalledWith("The accepted wording matches our source.");
});
