import { fireEvent, render, screen, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./toast";

function Harness({ onApi }: { onApi?: (api: ReturnType<typeof useToast>) => void }) {
  const api = useToast();
  onApi?.(api);
  return null;
}

function setup(onApi?: (api: ReturnType<typeof useToast>) => void) {
  return render(<ToastProvider><Harness onApi={onApi} /></ToastProvider>);
}

describe("ToastProvider", () => {
  beforeEach(() => { vi.useRealTimers(); });

  it("announces success and info toasts as status and danger toasts as alerts", () => {
    let api: ReturnType<typeof useToast> | undefined;
    setup(next => { api = next; });
    act(() => {
      api!.success("Student added.");
      api!.info("Season books are locked.");
      api!.danger("Could not save questions.");
    });
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toHaveTextContent("Student added.");
    expect(statuses[1]).toHaveTextContent("Season books are locked.");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save questions.");
  });

  it("auto-dismisses after the tone default duration", () => {
    vi.useFakeTimers();
    let api: ReturnType<typeof useToast> | undefined;
    setup(next => { api = next; });
    act(() => { api!.success("Student added."); });
    expect(screen.getByText("Student added.")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText("Student added.")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("dismisses a toast through its dismiss button", () => {
    let api: ReturnType<typeof useToast> | undefined;
    setup(next => { api = next; });
    act(() => { api!.info("Something happened."); });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Something happened.")).not.toBeInTheDocument();
  });

  it("runs the action and dismisses the toast when the action is used", () => {
    let api: ReturnType<typeof useToast> | undefined;
    const onAction = vi.fn();
    setup(next => { api = next; });
    act(() => { api!.danger("Assignments could not load.", { action: { label: "Retry", onAction } }); });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Assignments could not load.")).not.toBeInTheDocument();
  });

  it("caps the visible stack and drops the oldest toast", () => {
    let api: ReturnType<typeof useToast> | undefined;
    setup(next => { api = next; });
    act(() => {
      for (let index = 1; index <= 6; index++) api!.info(`Message ${index}`, { duration: 0 });
    });
    expect(screen.queryByText("Message 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Message 2")).not.toBeInTheDocument();
    expect(screen.getByText("Message 3")).toBeInTheDocument();
    expect(screen.getByText("Message 6")).toBeInTheDocument();
  });

  it("throws when useToast is called outside the provider", () => {
    const consoleError = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Harness />)).toThrow("useToast must be used inside <ToastProvider>.");
    } finally {
      console.error = consoleError;
    }
  });
});
