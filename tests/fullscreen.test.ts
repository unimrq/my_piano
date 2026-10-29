import { describe, expect, it, vi } from "vitest";
import {
  browserFullscreenElement,
  toggleBrowserFullscreen,
} from "../src/fullscreen";

const documentWith = (properties: object) => properties as Document;

describe("浏览器全屏", () => {
  it("标准 API 请求隐藏浏览器工具栏，并支持退出", async () => {
    const requestFullscreen = vi.fn(),
      exitFullscreen = vi.fn();
    const doc = documentWith({
      documentElement: { requestFullscreen },
      exitFullscreen,
    });
    await toggleBrowserFullscreen(doc);
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
    Object.assign(doc, { fullscreenElement: doc.documentElement });
    expect(browserFullscreenElement(doc)).toBe(doc.documentElement);
    await toggleBrowserFullscreen(doc);
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it("支持只有 WebKit 前缀的请求、状态与退出", async () => {
    const webkitRequestFullscreen = vi.fn(),
      webkitExitFullscreen = vi.fn();
    const doc = documentWith({
      documentElement: { webkitRequestFullscreen },
      webkitExitFullscreen,
    });
    await toggleBrowserFullscreen(doc);
    expect(webkitRequestFullscreen).toHaveBeenCalledOnce();
    Object.assign(doc, { webkitFullscreenElement: doc.documentElement });
    expect(browserFullscreenElement(doc)).toBe(doc.documentElement);
    await toggleBrowserFullscreen(doc);
    expect(webkitExitFullscreen).toHaveBeenCalledOnce();
  });

  it("宿主未开放全屏时明确失败，不伪造全屏状态", async () => {
    const requestFullscreen = vi.fn();
    const doc = documentWith({
      documentElement: { requestFullscreen },
      fullscreenEnabled: false,
    });
    await expect(toggleBrowserFullscreen(doc)).rejects.toThrow("Full Screen");
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(browserFullscreenElement(doc)).toBeFalsy();
  });

  it("保留浏览器拒绝请求的失败结果", async () => {
    const doc = documentWith({
      documentElement: {
        requestFullscreen: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });
    await expect(toggleBrowserFullscreen(doc)).rejects.toThrow("denied");
  });
});
