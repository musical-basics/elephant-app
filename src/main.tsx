import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { prepareLocalPianoConnection } from "./lib/localPianoConnection";
import "./styles.css";
import { ConnectWorkspace } from "./components/WorkspaceConnection";

const parameters = new URLSearchParams(window.location.hash.slice(1));
const requested = parameters.get("workspace-connect");
const connecting = requested !== null || window.location.hash === "#/connect";
if (requested !== null)
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}#/connect`,
  );
const localPiano = connecting
  ? { key: null, storageError: false }
  : prepareLocalPianoConnection();
// A private link can also be opened in a tab where Elephant is already running.
window.addEventListener("hashchange", () => {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  if (
    parameters.has("piano-connect") ||
    parameters.has("workspace-connect") ||
    window.location.hash === "#/connect" ||
    (connecting && window.location.hash !== "#/connect")
  )
    window.location.reload();
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {connecting ? (
      <ConnectWorkspace initialKey={requested ?? ""} />
    ) : (
      <App localPiano={localPiano} />
    )}
  </React.StrictMode>,
);
