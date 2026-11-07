import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted fonts (no CDN): Inter variable for UI, JetBrains Mono for numbers and IDs.
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./tokens.css";
import "./primitives.css";
import "./styles.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
