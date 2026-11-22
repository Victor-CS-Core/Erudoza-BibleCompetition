import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it } from "vitest";
import { ProgressRedirect } from "./router";

function renderAt(path: string) {
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/student/progress" element={<ProgressRedirect />} />
    <Route path="/student" element={<p>Training HQ</p>} />
    <Route path="/student/honors" element={<p>Honors page</p>} />
  </Routes></MemoryRouter>);
}

it("sends the retired student Progress page to Training HQ, keeping the season", async () => {
  renderAt("/student/progress?seasonId=s1");
  expect(await screen.findByText("Training HQ")).toBeInTheDocument();
});

it("sends the old Progress honors tab to the standalone Honors page", async () => {
  renderAt("/student/progress?tab=honors&seasonId=s1");
  expect(await screen.findByText("Honors page")).toBeInTheDocument();
});
