import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { applyStoredTheme } from "@/hooks/useTheme";
import "@/index.css";

// Sync <html class="dark"> from localStorage before the first render: since sub-project 28
// the theme toggle only lives on the Settings page, so a page that never calls useTheme()
// itself (Positions, Historique, un Journal) must not depend on some other page's hook
// having mounted first to pick up a stored dark preference.
applyStoredTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
