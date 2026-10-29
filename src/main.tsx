import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (
  import.meta.env.PROD &&
  window.isSecureContext &&
  "serviceWorker" in navigator
) {
  navigator.serviceWorker
    .register("./sw.js", { updateViaCache: "none" })
    .catch((error) => console.warn("离线缓存尚未启用", error));
}
