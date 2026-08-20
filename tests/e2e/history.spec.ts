import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "perch.conversations",
      JSON.stringify([
        {
          id: "newer",
          title: "Trip planning",
          createdAt: 1,
          updatedAt: 4,
          messages: [{ id: "one", role: "user", content: "Find a quiet hotel", ts: 2 }],
        },
        {
          id: "older",
          title: "Recipes",
          createdAt: 1,
          updatedAt: 3,
          messages: [{ id: "two", role: "assistant", content: "Tomato soup", ts: 2 }],
        },
      ]),
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: /skip for now/i }).click();
  await page.getByRole("button", { name: "History" }).click();
});

test("history search is keyboard accessible and restores stable order", async ({
  page,
}) => {
  const search = page.getByRole("searchbox", { name: "Search conversations" });
  await search.fill("TOMATO");
  await expect(page.locator(".main", { hasText: "Recipes" })).toBeVisible();
  await expect(page.locator(".main", { hasText: "Trip planning" })).toBeHidden();

  await search.fill("missing");
  await expect(page.getByText("No conversations match “missing”.")).toBeVisible();
  await search.fill("");
  await expect(page.locator(".row .title")).toHaveText(["Trip planning", "Recipes"]);
});

test("browser preview exports the complete history", async ({ page }) => {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export all as JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("perch-history.json");
});
