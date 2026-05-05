// Helpers that translate between React Router's basename-relative paths and the
// absolute URL paths that live behind the optional `/portal/` mount.
//
// During dev (Vite default) `import.meta.env.BASE_URL === "/"` and the helpers
// behave as no-ops. In production we build with `VITE_BASE=/portal/` so the new
// app can be mounted alongside (or in place of) the legacy embedded portal.

export function appBasename(baseURL: string): string {
  // React Router's `basename` accepts an empty string for "no prefix" and
  // a slash-prefixed path otherwise. Strip trailing slashes so "/portal/"
  // becomes "/portal" and "/" becomes "".
  return baseURL.replace(/\/+$/, "");
}

export function fullPath(routerPath: string, baseURL: string): string {
  // `routerPath` comes from React Router state (e.g. `useLocation().pathname`)
  // and is always basename-relative with a leading slash. Returns the absolute
  // URL path including the mount prefix so it can be handed to the backend
  // (OIDC `next` redirect) or `window.location`.
  const base = appBasename(baseURL);
  if (!routerPath || routerPath === "/") return baseURL || "/";
  const path = routerPath.startsWith("/") ? routerPath : `/${routerPath}`;
  return `${base}${path}`;
}
