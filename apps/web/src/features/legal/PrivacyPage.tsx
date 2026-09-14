import { LegalPage } from "./LegalPage";
import { PRIVACY_META, PRIVACY_SECTIONS } from "./legalContent";

export function PrivacyPage() {
  return (
    <LegalPage
      testId="privacy"
      title="Privacy Policy"
      description="How Erudoza collects, uses, shares, stores, and protects personal information. This is a starting draft — bracketed items are unfinished and require counsel and product review before publication."
      meta={PRIVACY_META}
      sections={PRIVACY_SECTIONS}
    />
  );
}
