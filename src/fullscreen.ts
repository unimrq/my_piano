type WebKitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void | Promise<void>;
};
type WebKitElement = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>;
};

export const fullscreenHelp =
  "网页全屏不可用，请使用浏览器的全屏功能（MIDIWeb Browser：Full Screen）。";

export function browserFullscreenElement(doc: Document = document) {
  return (
    doc.fullscreenElement || (doc as WebKitDocument).webkitFullscreenElement
  );
}

export async function toggleBrowserFullscreen(doc: Document = document) {
  const webkit = doc as WebKitDocument;
  if (doc.fullscreenElement) {
    await doc.exitFullscreen();
  } else if (webkit.webkitFullscreenElement && webkit.webkitExitFullscreen) {
    await webkit.webkitExitFullscreen();
  } else {
    const root = doc.documentElement as WebKitElement;
    if (root.requestFullscreen && doc.fullscreenEnabled !== false)
      await root.requestFullscreen({ navigationUI: "hide" });
    else if (
      root.webkitRequestFullscreen &&
      webkit.webkitFullscreenEnabled !== false
    )
      await root.webkitRequestFullscreen();
    else throw new Error(fullscreenHelp);
  }
}
