// What any page can read about the browser without asking for a single permission.
// Each probe has its own try/catch and timeout: a blocked API just leaves its field out.

import { candidateAddress } from "./lib.js";

const withTimeout = (promise, ms, fallback) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);

const safe = (fn) => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Draws text, an emoji and blended shapes: tiny differences in fonts, GPU and anti-aliasing change the pixels. */
async function canvasHash() {
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 60;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.textBaseline = "top";
  ctx.font = "16px 'Arial'";
  ctx.fillStyle = "#f60";
  ctx.fillRect(100, 1, 62, 20);
  ctx.fillStyle = "#069";
  ctx.fillText("portfolio <canvas> 1.0 \u{1F512}", 2, 15);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
  ctx.beginPath();
  ctx.arc(50, 30, 25, 0, Math.PI * 2);
  ctx.fill();
  return (await sha256Hex(canvas.toDataURL())).slice(0, 16);
}

function webgl() {
  const gl = document.createElement("canvas").getContext("webgl");
  if (!gl) return undefined;
  // Firefox now answers the unmasked values on the plain constants; Chromium still needs the extension.
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    vendor: String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR)).slice(0, 120),
    renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)).slice(0, 200),
  };
}

/** Gathers ICE candidates with no STUN server: only the device's own addresses, nothing leaves the browser for it. */
async function webrtcCandidates() {
  if (typeof RTCPeerConnection !== "function") return undefined;
  const pc = new RTCPeerConnection({ iceServers: [] });
  const found = new Set();
  const done = new Promise((resolve) => {
    pc.onicecandidate = (e) => {
      if (!e.candidate) return resolve();
      const address = e.candidate.address ?? candidateAddress(e.candidate.candidate);
      if (address) found.add(address);
    };
  });
  try {
    pc.createDataChannel("probe");
    await pc.setLocalDescription(await pc.createOffer());
    await withTimeout(done, 1500);
  } finally {
    pc.close();
  }
  return [...found].slice(0, 12);
}

async function uaData() {
  const data = navigator.userAgentData;
  if (!data) return undefined;
  const high = await withTimeout(
    data.getHighEntropyValues(["platformVersion", "architecture", "model", "fullVersionList"]).catch(() => ({})),
    800,
    {},
  );
  return {
    brands: data.brands?.slice(0, 10),
    mobile: data.mobile,
    platform: data.platform,
    platformVersion: high.platformVersion || undefined,
    architecture: high.architecture || undefined,
    model: high.model || undefined,
    fullVersionList: high.fullVersionList?.slice(0, 10),
  };
}

async function mediaDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return undefined;
  // Without permission the labels are blank, but the count of each kind still shows.
  const devices = await navigator.mediaDevices.enumerateDevices();
  const count = (kind) => devices.filter((d) => d.kind === kind).length;
  return { audioinput: count("audioinput"), audiooutput: count("audiooutput"), videoinput: count("videoinput") };
}

export async function collectProbe() {
  const [canvas, rtc, hints, media] = await Promise.all([
    canvasHash().catch(() => undefined),
    webrtcCandidates().catch(() => undefined),
    uaData().catch(() => undefined),
    withTimeout(
      mediaDevices().catch(() => undefined),
      800,
      undefined,
    ),
  ]);
  const conn = navigator.connection;
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform || undefined,
    languages: navigator.languages?.slice(0, 10),
    timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
    screen: {
      width: screen.width,
      height: screen.height,
      pixelRatio: Math.round(devicePixelRatio * 100) / 100,
      colorDepth: screen.colorDepth,
    },
    hardwareConcurrency: navigator.hardwareConcurrency || undefined,
    deviceMemory: navigator.deviceMemory,
    maxTouchPoints: navigator.maxTouchPoints,
    webdriver: navigator.webdriver,
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack === "1" ? true : undefined,
    globalPrivacyControl: navigator.globalPrivacyControl,
    pluginCount: navigator.plugins?.length,
    webgl: safe(webgl),
    canvasHash: canvas,
    uaData: hints,
    webrtcCandidates: rtc,
    connection: conn ? { effectiveType: conn.effectiveType, rttMs: conn.rtt, downlinkMbps: conn.downlink } : undefined,
    mediaDevices: media,
  };
}
