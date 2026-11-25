import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConsentPage, loadConsentRequest } from "./consent";
import { LoginPage } from "./login";
import "./styles.css";

const page =
  window.location.pathname === "/consent" ? (
    <ConsentPage
      request={
        await loadConsentRequest(new URLSearchParams(window.location.search)).catch(() => null)
      }
    />
  ) : (
    <LoginPage />
  );
createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
