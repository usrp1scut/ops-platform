// The SPA is served at the domain root by the standalone web/ (nginx) image
// in every environment — ops-api embeds no UI and there is no /portal mount
// anymore. These helpers therefore normally operate on `import.meta.env.
// BASE_URL === "/"` and are effectively no-ops; they are kept so a future
// sub-path deploy (VITE_BASE) still works without touching the router or the
// OIDC redirect.

export function appBasename(baseURL: string): string {
  // React Router's `basename` wants "" for "no prefix" and a slash-prefixed
  // path otherwise. Strip trailing slashes so "/" becomes "" (the normal
  // root case) and a hypothetical "/sub/" becomes "/sub".
  return baseURL.replace(/\/+$/, "");
}

export function fullPath(routerPath: string, baseURL: string): string {
  // `routerPath` comes from React Router state (e.g. `useLocation().pathname`)
  // and is basename-relative with a leading slash. Returns the absolute URL
  // path (including any mount prefix) for the backend OIDC `next` redirect.
  // At root this just returns `routerPath` unchanged.
  const base = appBasename(baseURL);
  if (!routerPath || routerPath === "/") return baseURL || "/";
  const path = routerPath.startsWith("/") ? routerPath : `/${routerPath}`;
  return `${base}${path}`;
}
