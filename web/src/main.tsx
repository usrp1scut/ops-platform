import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { AppProviders } from "./app/providers/AppProviders";
// Tokens must load before app.css so var() references resolve on first paint.
import "./styles/tokens.css";
import "./styles/app.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
