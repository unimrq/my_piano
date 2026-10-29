import { planFingering } from "./vendor/pianoplayer";
self.onmessage = (event) => {
  try {
    self.postMessage({
      result: planFingering(event.data.notes, event.data.size),
    });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
