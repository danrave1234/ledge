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
  await expect(screen).toHaveAttribute("aria-pressed", "true");
  // Capture happens on send; the browser preview has no screen to capture.
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Screen capture requires the desktop app.",
  );
  await expect(page.getByRole("region", { name: "Screen capture preview" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Region" })).toHaveCount(0);
});

test("enabled screen review exposes only redaction controls", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "perch.plugin.screen-context",
      JSON.stringify({ schemaVersion: 1, reviewBeforeSend: true }),
    );
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command === "store_read") return localStorage.getItem(String(args.key));
          if (command === "store_write") {
            localStorage.setItem(String(args.key), String(args.value));
            return null;
          }
          if (command === "capture_context") {
            return {
              data_url:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XkFeNwAAAABJRU5ErkJggg==",
              width: 1,
              height: 1,
              text: "screen text",
            };
          }
          return null;
        },
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /skip for now/i }).click();
  await page.getByRole("button", { name: "Screen", exact: true }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("What is this?");
  // With review on, the first press captures for review instead of sending.
  await page.getByRole("button", { name: "Capture screen for review" }).click();

  await expect(
    page.getByRole("region", { name: "Screen capture preview" }),
  ).toBeVisible();
  await expect(page.getByRole("log")).not.toContainText("What is this?");
  // Undo only appears once something has been redacted.
  await expect(page.getByRole("button", { name: "Undo redactions" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Recapture screen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove screen capture" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Region" })).toHaveCount(0);
  await expect(page.locator('input[type="number"]')).toHaveCount(0);

  // The second press sends exactly the reviewed capture.
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("What is this?");
  await expect(page.getByRole("region", { name: "Screen capture preview" })).toHaveCount(
    0,
  );
});

test("screen review preference is keyboard operable and persists", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /skip for now/i }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Plugins", exact: true }).click();

  const review = page.getByRole("switch", {
    name: "Review and redact before sending",
  });
  const automatic = page.getByRole("switch", {
    name: "Automatically redact sensitive data",
  });
  await expect(automatic).toHaveAttribute("aria-checked", "true");
  await automatic.focus();
  await automatic.press("Enter");
  await expect(automatic).toHaveAttribute("aria-checked", "false");
  await expect(review).toHaveAttribute("aria-checked", "false");
  await review.focus();
  await review.press("Enter");
  await expect(review).toHaveAttribute("aria-checked", "true");

  await page.waitForTimeout(300);
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Review and redact before sending" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("switch", { name: "Automatically redact sensitive data" }),
  ).toHaveAttribute("aria-checked", "false");
});

test("composer toggles remain enabled after sending until explicitly disabled", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command === "store_read") return localStorage.getItem(String(args.key));
          if (command === "store_write") {
            localStorage.setItem(String(args.key), String(args.value));
            return null;
          }
          if (command === "capture_context") {
            return {
              data_url:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XkFeNwAAAABJRU5ErkJggg==",
              width: 1,
              height: 1,
              text: "screen text",
            };
          }
          return null;
        },
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /skip for now/i }).click();

  const web = page.getByRole("button", { name: "Web", exact: true });
  const screen = page.getByRole("button", { name: "Screen", exact: true });

  await web.click();
  await screen.click();

  await page.getByRole("textbox", { name: "Message" }).fill("Keep my toggles on");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(web).toHaveAttribute("aria-pressed", "true");
  await expect(screen).toHaveAttribute("aria-pressed", "true");

  await web.click();
  await screen.click();
  await expect(web).toHaveAttribute("aria-pressed", "false");
  await expect(screen).toHaveAttribute("aria-pressed", "false");
});
