import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PrivacyPage } from "../features/legal/PrivacyPage";
import { TermsPage } from "../features/legal/TermsPage";
import { LandingPage } from "../features/marketing/LandingPage";

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PrivacyPage", () => {
  it("renders the policy title, non-affiliation disclaimer, and section structure", () => {
    renderAt("/privacy", <PrivacyPage />);
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
    expect(within(main).getByRole("status")).toHaveTextContent(/not affiliated with, authorized by/);
    expect(within(main).getByRole("heading", { level: 2, name: "1. Scope and who is responsible" })).toBeInTheDocument();
    expect(within(main).getByRole("heading", { level: 2, name: "7. Children’s and teens’ privacy" })).toBeInTheDocument();
    expect(within(main).getByRole("heading", { level: 2, name: "16. Contact us" })).toBeInTheDocument();
  });

  it("keeps bracketed placeholders verbatim and shows the real contact details", () => {
    renderAt("/privacy", <PrivacyPage />);
    const main = screen.getByRole("main");
    expect(within(main).getAllByText(/\[EFFECTIVE DATE\]/).length).toBeGreaterThan(0);
    expect(within(main).getAllByText(/\[LEGAL ENTITY NAME\]/).length).toBeGreaterThan(0);
    expect(within(main).getByText(/941 Southridge Trail, Altamonte Springs, Florida \[ZIP\]/)).toBeInTheDocument();
    const mailLinks = within(main).getAllByRole("link", { name: "Ktr0nn@icloud.com" });
    expect(mailLinks.length).toBeGreaterThan(0);
    for (const link of mailLinks) expect(link).toHaveAttribute("href", "mailto:Ktr0nn@icloud.com");
    expect(within(main).getByText(/Scripture text used for training and study purposes/)).toBeInTheDocument();
  });
});

describe("TermsPage", () => {
  it("renders the terms title, non-affiliation disclaimer, and section structure", () => {
    renderAt("/terms", <TermsPage />);
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 1, name: "Terms of Service" })).toBeInTheDocument();
    expect(within(main).getByRole("status")).toHaveTextContent(/not affiliated with, authorized by/);
    expect(within(main).getByRole("heading", { level: 2, name: "8. Independent service; no official affiliation" })).toBeInTheDocument();
    expect(within(main).getByRole("heading", { level: 2, name: "20. Contact information" })).toBeInTheDocument();
    expect(within(main).getByRole("link", { name: "nadpbe.org" })).toHaveAttribute("href", "https://nadpbe.org/");
  });

  it("keeps bracketed placeholders verbatim", () => {
    renderAt("/terms", <TermsPage />);
    const main = screen.getByRole("main");
    expect(within(main).getAllByText(/\[GOVERNING JURISDICTION\]/).length).toBeGreaterThan(0);
    expect(within(main).getByText(/New King James Version \(NKJV\), copyright/)).toBeInTheDocument();
  });
});

describe("public footer legal links", () => {
  it("links to /privacy and /terms from the landing page footer", () => {
    renderAt("/", <LandingPage />);
    const footer = screen.getByRole("contentinfo");
    const legal = within(footer).getByRole("navigation", { name: "Legal" });
    expect(within(legal).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(within(legal).getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });
});
