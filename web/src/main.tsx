import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
// Liga o cliente HTTP a sessao antes de qualquer componente montar.
import "./lib/session";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
