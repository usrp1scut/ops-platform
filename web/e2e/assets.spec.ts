import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "./helpers/auth";

test("CMDB asset workspace renders after login", async ({ page }) => {
  await signInAsAdmin(page);

  await page.getByRole("link", { name: /^cmdb$/i }).click();

  await expect(page).toHaveURL(/\/cmdb$/);
  await expect(page.getByRole("heading", { name: "CMDB assets" })).toBeVisible();

  // Either the asset table or an empty-state notice should be visible
  // depending on whether the test database has any assets. Both prove
  // the list query reached the backend successfully.
  const tableOrEmpty = page.locator(".data-table, .notice-row");
  await expect(tableOrEmpty.first()).toBeVisible();

  // The "New asset" CTA is only rendered when the user has
  // cmdb.asset:write — the bootstrap admin always does, so this also
  // verifies that the permission helper sees `system:admin`.
  await expect(page.getByRole("button", { name: /new asset/i })).toBeVisible();
});
