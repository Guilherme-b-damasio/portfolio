import type { ExposureCheck } from "../../../domain/exposure.js";
import {
  AutomationCheck,
  FingerprintSurfaceCheck,
  GpuCheck,
  OutdatedBrowserCheck,
  PlatformCheck,
  TimezoneCheck,
  UserAgentLayersCheck,
} from "./browser.js";
import { ClientHintsCheck, LanguageCheck, PrivacySignalCheck, ToolClientCheck } from "./http.js";
import { ReverseDnsCheck, WebRtcLeakCheck } from "./network.js";
import { TlsStackCheck, TlsStrengthCheck } from "./tls.js";

/** Every rule the scan runs, outermost layer first. A new rule is one more line here. */
export function scanChecks(): ExposureCheck[] {
  return [
    new ReverseDnsCheck(),
    new WebRtcLeakCheck(),
    new TlsStackCheck(),
    new TlsStrengthCheck(),
    new ToolClientCheck(),
    new ClientHintsCheck(),
    new PrivacySignalCheck(),
    new LanguageCheck(),
    new UserAgentLayersCheck(),
    new PlatformCheck(),
    new GpuCheck(),
    new TimezoneCheck(),
    new AutomationCheck(),
    new OutdatedBrowserCheck(),
    new FingerprintSurfaceCheck(),
  ];
}
