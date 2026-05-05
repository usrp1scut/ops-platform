import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "./helpers/auth";

// We exercise the OIDC settings *form* without saving — the bootstrap
// admin's runtime OIDC config must not be mutated by smoke tests, since
// other tests in the same database may rely on whatever the operator
// configured.

test("OIDC settings form renders with all required provider fields", async ({ page }) => {
  await signInAsAdmin(page);

  await page.getByRole("link", { name: /^oidc$/i }).click();

  await expect(page).toHaveURL(/\/oidc$/);
  await expect(page.getByRole("heading", { name: "OIDC", level: 1 })).toBeVisible();

  for (const label of [
    "Issuer URL",
    "Client ID",
    "Client secret",
    "Redirect URL",
    "Authorize URL",
    "Token URL",
    "Userinfo URL",
    "Scopes",
  ]) {
    await expect(page.getByLabel(label)).toBeVisible();
  }

  await expect(page.getByRole("button", { name: /save configuration/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /test connection/i })).toBeVisible();
});
