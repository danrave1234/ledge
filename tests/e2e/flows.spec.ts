import { expect, test, type Page } from "@playwright/test";

/* End-to-end checks for the everyday flows: they exercise the browser preview,
   which runs the offline demo model and native fallbacks. */

async function start(page: Page, init?: () => void) {
  if (init) await page.addInitScript(init);
  await page.goto("/");
  await page.getByRole("button", { name: /skip for now/i }).click();
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

test("skipping onboarding in the preview lands on the working demo model", async ({
  page,
}) => {
  await start(page);
  await expect(page.getByRole("button", { name: /mock/i }).first()).toBeVisible();
  await composer(page).fill("hello there");
  await composer(page).press("Enter");
  await expect(page.getByRole("log")).toContainText("offline");
  await expect(page.getByRole("button", { name: "Copy response" })).toBeVisible();
});

test("the message box is focused and keeps a draft across collapse", async ({ page }) => {
  await start(page);
  await expect(composer(page)).toBeFocused();
  await composer(page).fill("half a thought");
  await page.keyboard.press("Escape"); // collapse to the handle
  await expect(page.getByRole("button", { name: "Open Ledge" })).toBeVisible();
  await page.getByRole("button", { name: "Open Ledge" }).click();
  await expect(composer(page)).toHaveValue("half a thought");
});

test("Esc steps back through views before collapsing", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Control+,");
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(composer(page)).toBeVisible();
  await page.keyboard.press("Control+h");
  await expect(
    page.getByRole("searchbox", { name: "Search conversations" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(composer(page)).toBeVisible();
});

test("a web suggestion switches Web on and gets cited sources", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: /what's new in tech/i }).click();
  await expect(page.getByRole("button", { name: "Web", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Sources")).toBeVisible();
});

test("a failed reply offers Try again, which re-asks without duplicating", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // The OpenAI provider cannot run in the browser, so every send fails.
    localStorage.setItem(
      "perch.settings",
      JSON.stringify({ onboarded: true, providerId: "openai", model: "gpt-5.6-sol" }),
    );
  });
  await page.goto("/");
  await composer(page).fill("will fail");
  await composer(page).press("Enter");
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(retry).toBeVisible();
  await expect(page.locator(".bubble.user")).toHaveCount(1);
});

test("deleting a conversation can be undone", async ({ page }) => {
  await start(page, () => {
    localStorage.setItem(
      "perch.conversations",
      JSON.stringify([
        {
          id: "keep",
          title: "Weekend plans",
          createdAt: 1,
          updatedAt: Date.now(),
          messages: [{ id: "m", role: "user", content: "hike?", ts: 1 }],
        },
      ]),
    );
  });
  await page.getByRole("button", { name: "History" }).click();
  await page.getByRole("button", { name: "Delete Weekend plans" }).click();
  await expect(page.getByText("No conversations yet.")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".row .title")).toHaveText(["Weekend plans"]);
  await expect(page.getByText("Today")).toBeVisible();
});

test("the global hotkey is recorded from a key press", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const hotkey = page.getByRole("button", { name: /global hotkey/i });
  await hotkey.click();
  await page.keyboard.press("Control+Alt+K");
  await expect(hotkey).toContainText("Ctrl");
  await expect(hotkey).toContainText("Alt");
  await expect(hotkey).toContainText("K");
  await expect(page.getByText("Hotkey updated")).toBeVisible();
  // Esc while recording cancels instead of leaving Settings.
  await hotkey.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
});

test("removing a plugin asks for a second click instead of a native dialog", async ({
  page,
}) => {
  let dialogs = 0;
  page.on("dialog", () => dialogs++);
  await start(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  const install = page.getByRole("button", { name: "Install" }).first();
  await install.click();
  const remove = page.getByRole("button", { name: "Remove" }).first();
  await remove.click();
  await expect(page.getByRole("button", { name: "Click again to remove" })).toBeVisible();
  await page.getByRole("button", { name: "Click again to remove" }).click();
  await expect(page.getByText(/^Removed /)).toBeVisible();
  expect(dialogs).toBe(0);
});

test("settings switches expose switch semantics", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const hover = page.getByRole("switch", { name: "Open on hover" });
  const before = await hover.getAttribute("aria-checked");
  await hover.click();
  await expect(hover).not.toHaveAttribute("aria-checked", before!);
});

test("About shows the Ledge brand and shortcuts", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "About", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ledge" })).toBeVisible();
  await expect(page.getByText("Open or close Ledge from anywhere")).toBeVisible();
});
