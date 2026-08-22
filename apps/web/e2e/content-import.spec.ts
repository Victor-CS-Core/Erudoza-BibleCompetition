import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, identifier: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-identifier").fill(identifier);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

function samplePack(packKey: string) {
  return {
    packKey,
    version: 1,
    locale: "en",
    sourceType: "Scripture",
    documents: [
      {
        name: "Joshua",
        units: [
          {
            citation: "Joshua 1:1",
            bookKey: "JOS",
            chapter: 1,
            verse: 1,
            ordinal: 1,
            text: "Development sample: Joshua rose early.",
          },
          {
            citation: "Joshua 1:2",
            bookKey: "JOS",
            chapter: 1,
            verse: 2,
            ordinal: 2,
            text: "Development sample: Moses is mentioned as servant.",
          },
          {
            citation: "Joshua 1:3",
            bookKey: "JOS",
            chapter: 1,
            verse: 3,
            ordinal: 3,
            text: "Development sample: Every place your foot treads.",
          },
          {
            citation: "Joshua 2:1",
            bookKey: "JOS",
            chapter: 2,
            verse: 1,
            ordinal: 4,
            text: "Development sample: Joshua sent two men to Jericho.",
          },
        ],
      },
    ],
  };
}

test("coach can import a synthetic pack and browse stored verses", async ({ page }) => {
  const packKey = `dev-joshua-${Date.now()}`;
  await login(page, "admin@erudoza.local", "DevAdmin!234");
  await expect(page.getByTestId("organization-name")).toBeVisible();
  await page.getByRole("link", { name: "Content" }).click();
  await expect(page.getByTestId("load-sample-pack")).toBeVisible();
  await page.getByTestId("load-sample-pack").click();
  await expect(page.getByTestId("import-pack-json")).toHaveValue(/"packKey": "dev-joshua"/);
  await page.getByTestId("import-pack-json").fill(JSON.stringify(samplePack(packKey)));
  await page.getByTestId("import-pack-submit").click();
  await expect(page.getByTestId("content-pack").filter({ hasText: packKey })).toBeVisible();
  await page.getByTestId("content-pack").filter({ hasText: packKey }).click();
  await expect(page.getByTestId("source-unit-list")).toContainText("Joshua 1:1");
  await expect(page.getByTestId("source-unit-list")).toContainText("Development sample: Joshua rose early.");

  await page.goto("/admin/seasons/new");
  await page.getByTestId("season-name").fill(`Imported ${packKey}`);
  await page.getByTestId("save-season").click();
  await expect(page.getByTestId("select-content-pack")).toContainText(packKey);
  const packValue = await page
    .getByTestId("select-content-pack")
    .locator("option", { hasText: packKey })
    .getAttribute("value");
  await page.getByTestId("select-content-pack").selectOption(packValue!);
  await expect(page.getByTestId("select-content-pack")).toHaveValue(packValue!);
  await page.getByTestId("scope-book").fill("JOS");
  await page.getByTestId("scope-start-chapter").fill("2");
  await page.getByTestId("scope-start").fill("1");
  await page.getByTestId("scope-end-chapter").fill("2");
  await page.getByTestId("scope-end").fill("1");
  await page.getByTestId("save-scope").click();
  await expect(page.getByText("Scope saved.")).toBeVisible();
  await page.getByTestId("assign-student-select").selectOption({ label: "Daniel Student" });
  await page.getByTestId("assign-student").click();
  await expect(page.getByText("Assignment saved.")).toBeVisible();
  await page.getByTestId("chapter-tab-roster").click();
  await expect(page.getByTestId("season-roster")).toContainText("JOS 2:1");
});
