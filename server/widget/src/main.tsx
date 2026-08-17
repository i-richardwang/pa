import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement);

async function bootstrap() {
  const mode = document.querySelector('meta[name="pa-widget-mode"]')?.getAttribute("content");
  if (mode === "records") {
    const [{ RecordCard }, host] = await Promise.all([
      import("@widget/components/record_card"),
      import("./record_host.js"),
    ]);
    function HostedRecords() {
      const state = host.useRecordHostState();
      return (
        <RecordCard
          payload={state.payload}
          status={state.status}
          loading={state.loading}
          fullscreen={state.displayMode === "fullscreen"}
          canFullscreen={state.canFullscreen}
          onPage={host.loadRecordPage}
          onFullscreen={host.requestRecordFullscreen}
        />
      );
    }
    void host.connectRecordHost();
    root.render(
      <StrictMode>
        <HostedRecords />
      </StrictMode>,
    );
    return;
  }

  const [{ ResultCard }, host] = await Promise.all([
    import("@widget/components/result_card"),
    import("./host.js"),
  ]);
  function HostedAnalysis() {
    const state = host.useHostState();
    return (
      <ResultCard
        payload={state.payload}
        presentation={state.presentation}
        exportResource={state.exportResource}
        status={state.status}
        waiting={state.status === host.WAITING_STATUS}
        fullscreen={state.displayMode === "fullscreen"}
        actions={{
          ...(state.exportDelivery
            ? {
                exportAction: {
                  kind: state.exportDelivery,
                  run: (_link, resource) => host.runExport(resource),
                },
              }
            : {}),
          ...(state.canFullscreen ? { requestFullscreen: host.requestFullscreen } : {}),
        }}
      />
    );
  }
  void host.connectHost();
  root.render(
    <StrictMode>
      <HostedAnalysis />
    </StrictMode>,
  );
}

void bootstrap();
