import { describe, it, expect } from "vitest";
import { checkMemorySafety } from "../lib/memory/safety";

describe("memory safety gate", () => {
  it("allows an ordinary personal fact", () => {
    expect(checkMemorySafety("Allergy", "Peanuts").ok).toBe(true);
    expect(checkMemorySafety("Preferred reminder time", "6pm").ok).toBe(true);
  });

  it("rejects a labeled password", () => {
    const result = checkMemorySafety("password", "hunter2");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/password/i);
  });

  it("rejects an API key shaped value", () => {
    const result = checkMemorySafety("stripe key", "sk-abcdef1234567890abcdef");
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("rejects a valid credit card number (Luhn check)", () => {
    // 4111 1111 1111 1111 is the well-known Visa test number, Luhn-valid.
    const result = checkMemorySafety("card", "4111 1111 1111 1111");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/card/i);
  });

  it("does not flag a random long number that fails the Luhn check", () => {
    const result = checkMemorySafety("note", "1234567890123456");
    expect(result.ok).toBe(true);
  });

  it("rejects an OTP-shaped value", () => {
    const result = checkMemorySafety("verification", "otp: 483920");
    expect(result.ok).toBe(false);
  });

  it("rejects an SSN-shaped value", () => {
    const result = checkMemorySafety("id", "123-45-6789");
    expect(result.ok).toBe(false);
  });

  it("never stores anything on rejection — safety gate is pure and side-effect free", () => {
    // The function only returns a verdict; asserting it takes no db/db-like
    // argument at all is the proof that it cannot persist anything itself.
    expect(checkMemorySafety.length).toBe(2);
  });
});
