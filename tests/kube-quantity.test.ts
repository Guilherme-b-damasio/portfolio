import { describe, expect, it } from "vitest";
import { bytes, cpuMilli, parseQuantity } from "../src/infrastructure/cluster/quantity.js";

describe("Kubernetes quantities", () => {
  it("reads CPU as millicores, whatever unit metrics-server or the node used", () => {
    expect(cpuMilli("250m")).toBe(250);
    expect(cpuMilli("2")).toBe(2000);
    expect(cpuMilli("0.5")).toBe(500);
    expect(cpuMilli("123456789n")).toBe(123);
    expect(cpuMilli("1500u")).toBe(2);
  });

  it("reads memory as bytes, binary and decimal suffixes alike", () => {
    expect(bytes("64Mi")).toBe(64 * 1024 * 1024);
    expect(bytes("3999784Ki")).toBe(3999784 * 1024);
    expect(bytes("1G")).toBe(1e9);
    expect(bytes("1e3")).toBe(1000);
    expect(bytes("2Gi")).toBe(2 * 1024 ** 3);
    expect(bytes("1048576")).toBe(1048576);
  });

  it("refuses what is not a quantity", () => {
    expect(parseQuantity("")).toBeNull();
    expect(parseQuantity("12 Mi")).toBeNull();
    expect(parseQuantity("Mi")).toBeNull();
    expect(cpuMilli("lots")).toBeNull();
  });
});
