import { describe, expect, it } from "vitest";
import { addressKind, plainIp } from "../src/application/scan/ip.js";
import { osFromPlatform, parseUserAgent, sameOs } from "../src/application/scan/user-agent.js";
import { UA } from "./fixtures/user-agents.js";

describe("parseUserAgent", () => {
  it("tells Chromium browsers apart even though they all say Chrome", () => {
    expect(parseUserAgent(UA.chromeWin)).toEqual({
      browser: "chrome",
      version: 153,
      os: "windows",
      mobile: false,
      tool: null,
    });
    expect(parseUserAgent(UA.edgeWin)).toMatchObject({ browser: "edge", version: 153 });
  });

  it("reads Firefox, Safari and mobile devices", () => {
    expect(parseUserAgent(UA.firefoxLinux)).toMatchObject({ browser: "firefox", version: 157, os: "linux" });
    expect(parseUserAgent(UA.safariIphone)).toMatchObject({ browser: "safari", version: 18, os: "ios", mobile: true });
    expect(parseUserAgent(UA.safariMac)).toMatchObject({ browser: "safari", os: "macos", mobile: false });
    expect(parseUserAgent(UA.chromeAndroid)).toMatchObject({ browser: "chrome", os: "android", mobile: true });
  });

  it("names the client library when there is one", () => {
    expect(parseUserAgent(UA.curl)).toMatchObject({ tool: "curl", browser: "outro", os: "outro" });
    expect(parseUserAgent(UA.python).tool).toBe("python-requests");
    expect(parseUserAgent(UA.headless)).toMatchObject({ tool: "Chrome headless", browser: "chrome" });
    expect(parseUserAgent(undefined)).toMatchObject({ browser: "outro", tool: null });
  });
});

describe("platforms", () => {
  it("maps the platform strings browsers report", () => {
    expect(osFromPlatform("Win32")).toBe("windows");
    expect(osFromPlatform('"macOS"')).toBe("macos");
    expect(osFromPlatform("MacIntel")).toBe("macos");
    expect(osFromPlatform("iPhone")).toBe("ios");
    expect(osFromPlatform("Linux armv8l")).toBe("linux");
    expect(osFromPlatform("")).toBeNull();
  });

  it("accepts the pairs real devices produce", () => {
    expect(sameOs("android", "linux")).toBe(true);
    expect(sameOs("ios", "macos")).toBe(true);
    expect(sameOs("windows", "macos")).toBe(false);
  });
});

describe("addresses", () => {
  it("classifies what WebRTC can hand out", () => {
    expect(addressKind("1f6a7b2c-0d3e.local")).toBe("mdns");
    expect(addressKind("192.168.0.12")).toBe("privado");
    expect(addressKind("172.20.1.1")).toBe("privado");
    expect(addressKind("100.70.1.1")).toBe("cgnat");
    expect(addressKind("::ffff:200.150.1.2")).toBe("publico-v4");
    expect(addressKind("fe80::1")).toBe("local-v6");
    expect(addressKind("2804:14c:1:2::5")).toBe("publico-v6");
    expect(plainIp("::ffff:10.0.0.1")).toBe("10.0.0.1");
  });
});
