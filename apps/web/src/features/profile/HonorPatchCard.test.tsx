import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HonorPatchCard } from "./HonorPatchCard";

function card(action?: string) {
  return render(
    <HonorPatchCard
      title="Exact Recall"
      artwork={<img alt="Exact Recall patch" src="patch.png" />}
      status={<span>Locked</span>}
      detail={(close) => <><p>Reach 90 in exact wording.</p>{action && <button type="button" onClick={() => { vi.fn()(); close(); }}>{action}</button>}</>}
    />
  );
}

describe("HonorPatchCard", () => {
  it("shows the title and status on the card with the details hidden", () => {
    card();
    expect(screen.getByRole("heading", { name: "Exact Recall" })).toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Reach 90 in exact wording.")).not.toBeInTheDocument();
  });

  it("opens a square dialog with the details when the artwork is tapped", () => {
    card();
    fireEvent.click(screen.getByRole("button", { name: "Exact Recall: view details" }));
    const dialog = screen.getByRole("dialog", { name: "Exact Recall" });
    expect(dialog).toHaveClass("honor-patch-dialog");
    expect(screen.getByText("Reach 90 in exact wording.")).toBeInTheDocument();
  });

  it("closes the dialog and restores focus to the artwork button", () => {
    card();
    const art = screen.getByRole("button", { name: "Exact Recall: view details" });
    art.focus();
    fireEvent.click(art);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(art);
  });

  it("runs the contextual detail action from inside the dialog", () => {
    const onAction = vi.fn();
    render(
      <HonorPatchCard
        title="Exact Recall"
        artwork={<img alt="Exact Recall patch" src="patch.png" />}
        detail={(close) => <button type="button" onClick={() => { onAction(); close(); }}>Earn to unlock</button>}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Exact Recall: view details" }));
    fireEvent.click(screen.getByRole("button", { name: "Earn to unlock" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
