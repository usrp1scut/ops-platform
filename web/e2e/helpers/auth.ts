import type { Page } from "@playwright/test";

declare const process: { env: Record<string, string | undefined> };

const DEFAULT_USERNAME = process.env.OPS_LOCAL_ADMIN_USERNAME || "admin";
const DEFAULT_PASSWORD = process.env.OPS_LOCAL_ADMIN_PASSWORD || "admin123456";

/**
 * Sign in via the local admin form and wait until the AppShell sidebar
 * is rendered (proof that AuthProvider transitioned to "authenticated"
 * and ProtectedRoute let us through).
 */
export async function signInAsAdmin(
  page: Page,
  username: string = DEFAULT_USERNAME,
  password: string = DEFAULT_PASSWORD,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // The Overview link only renders inside the AppShell, which only
  // mounts after the bearer token is stored and the identity loads.
  await page.getByRole("link", { name: /overview/i }).waitFor({ state: "visible" });
}
