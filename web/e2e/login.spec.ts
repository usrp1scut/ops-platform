import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "./helpers/auth";

test("local admin can sign in and lands on the overview page", async ({ page }) => {
  await signInAsAdmin(page);

  await expect(page.getByRole("heading", { level: 1 })).toContainText(/good to see you/i);
  await expect(page.getByText("API health")).toBeVisible();
});

test("rejects empty credentials with an inline error", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByRole("alert")).toContainText(/required/i);
});
