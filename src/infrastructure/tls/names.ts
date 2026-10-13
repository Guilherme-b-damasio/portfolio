import { isGrease } from "../../domain/tls.js";

// IANA names for the codes browsers and common libraries actually send. Unknown codes show as hex.
const EXTENSIONS: Record<string, string> = {
  "0000": "server_name",
  "0005": "status_request",
  "000a": "supported_groups",
  "000b": "ec_point_formats",
  "000d": "signature_algorithms",
  "000f": "heartbeat",
  "0010": "alpn",
  "0012": "signed_certificate_timestamp",
  "0015": "padding",
  "0016": "encrypt_then_mac",
  "0017": "extended_master_secret",
  "001b": "compress_certificate",
  "001c": "record_size_limit",
  "0022": "delegated_credentials",
  "0023": "session_ticket",
  "0029": "pre_shared_key",
  "002a": "early_data",
  "002b": "supported_versions",
  "002d": "psk_key_exchange_modes",
  "0031": "post_handshake_auth",
  "0032": "signature_algorithms_cert",
  "0033": "key_share",
  "0039": "quic_transport_parameters",
  "4469": "application_settings (ALPS)",
  "44cd": "application_settings (ALPS, novo)",
  fe0d: "encrypted_client_hello",
  ff01: "renegotiation_info",
};

const CIPHERS: Record<string, string> = {
  "1301": "TLS_AES_128_GCM_SHA256",
  "1302": "TLS_AES_256_GCM_SHA384",
  "1303": "TLS_CHACHA20_POLY1305_SHA256",
  c02b: "ECDHE_ECDSA_AES_128_GCM_SHA256",
  c02c: "ECDHE_ECDSA_AES_256_GCM_SHA384",
  c02f: "ECDHE_RSA_AES_128_GCM_SHA256",
  c030: "ECDHE_RSA_AES_256_GCM_SHA384",
  cca8: "ECDHE_RSA_CHACHA20_POLY1305",
  cca9: "ECDHE_ECDSA_CHACHA20_POLY1305",
  c009: "ECDHE_ECDSA_AES_128_CBC_SHA",
  c00a: "ECDHE_ECDSA_AES_256_CBC_SHA",
  c013: "ECDHE_RSA_AES_128_CBC_SHA",
  c014: "ECDHE_RSA_AES_256_CBC_SHA",
  c023: "ECDHE_ECDSA_AES_128_CBC_SHA256",
  c024: "ECDHE_ECDSA_AES_256_CBC_SHA384",
  c027: "ECDHE_RSA_AES_128_CBC_SHA256",
  c028: "ECDHE_RSA_AES_256_CBC_SHA384",
  "009c": "RSA_AES_128_GCM_SHA256",
  "009d": "RSA_AES_256_GCM_SHA384",
  "009e": "DHE_RSA_AES_128_GCM_SHA256",
  "009f": "DHE_RSA_AES_256_GCM_SHA384",
  "002f": "RSA_AES_128_CBC_SHA",
  "0035": "RSA_AES_256_CBC_SHA",
  "003c": "RSA_AES_128_CBC_SHA256",
  "003d": "RSA_AES_256_CBC_SHA256",
  "000a": "RSA_3DES_EDE_CBC_SHA",
  "00ff": "EMPTY_RENEGOTIATION_INFO_SCSV",
};

const GROUPS: Record<string, string> = {
  "001d": "x25519",
  "001e": "x448",
  "0017": "secp256r1",
  "0018": "secp384r1",
  "0019": "secp521r1",
  "0100": "ffdhe2048",
  "0101": "ffdhe3072",
  "11ec": "X25519MLKEM768",
  "6399": "X25519Kyber768Draft00",
};

const named = (table: Record<string, string>) => (code: string) =>
  isGrease(code) ? `GREASE ${code}` : (table[code] ?? `0x${code}`);

export const extensionName = named(EXTENSIONS);
export const cipherName = named(CIPHERS);
export const groupName = named(GROUPS);

/** Hybrid key exchanges that resist a future quantum computer. */
export const POST_QUANTUM_GROUPS = new Set(["11ec", "6399"]);
