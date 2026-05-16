import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "./helpers/auth";

test("local admin can sign in and lands on the Connect front door", async ({ page }) => {
  await signInAsAdmin(page);

  // Plan A: Connect is the default route (the "find an asset and open it"
  // front door), replacing Overview as the post-login landing page.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/connect/i);
  await expect(page.getByRole("button", { name: /search assets/i })).toBeVisible();
});

test("rejects empty credentials with an inline error", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByRole("alert")).toContainText(/required/i);
});
