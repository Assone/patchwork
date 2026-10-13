import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return <div>Patchwork Commit Composer</div>;
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Webview root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
