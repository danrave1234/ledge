import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("onboarding has no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "Welcome" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")),
  ).toEqual([]);
});

test("chat controls expose their toggle and menu state", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /skip for now/i }).click();
  const model = page.getByRole("button", { name: /gpt|mock|codex/i }).first();
  await expect(model).toHaveAttribute("aria-expanded", "false");
  await model.click();
  await expect(model).toHaveAttribute("aria-expanded", "true");
});

test("screen capture uses one accessible current-window control", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /skip for now/i }).click();

  await expect(page.getByRole("combobox", { name: /capture target/i })).toHaveCount(0);
  const screen = page.getByRole("button", { name: "Screen", exact: true });
  await screen.focus();
  await expect(screen).toBeFocused();
  await screen.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Screen capture requires the desktop app.",
  );
});
