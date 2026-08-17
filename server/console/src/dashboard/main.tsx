import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { DashboardApp } from "./app";
import { createQueryClient } from "./query_client";
import "../styles.css";

const queryClient = createQueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DashboardApp />
    </QueryClientProvider>
  </StrictMode>,
);
