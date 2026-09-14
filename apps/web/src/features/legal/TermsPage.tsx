import { LegalPage } from "./LegalPage";
import { TERMS_INTRO, TERMS_META, TERMS_SECTIONS } from "./legalContent";

export function TermsPage() {
  return (
    <LegalPage
      testId="terms"
      title="Terms of Service"
      description="The legal agreement between you and Erudoza governing use of the Service. This is a starting draft — bracketed items are unfinished and require counsel and product review before publication."
      meta={TERMS_META}
      intro={TERMS_INTRO}
      sections={TERMS_SECTIONS}
    />
  );
}
