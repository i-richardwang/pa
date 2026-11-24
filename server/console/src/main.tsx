import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConsentPage } from "./consent";
import { LoginPage } from "./login";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.pathname === "/consent" ? <ConsentPage /> : <LoginPage />}
  </StrictMode>,
);
