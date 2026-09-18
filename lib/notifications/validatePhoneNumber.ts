/**
 * Pure E.164 phone number validator for call/SMS escalation destinations.
 *
 * Deliberately strict and deliberately dumb: it never reformats, trims, or
 * "fixes" a number (e.g. adding a missing "+" or stripping spaces) — an
 * invalid number is rejected with a clear reason so the caller can surface
 * an honest "invalid_number" outcome instead of silently calling the wrong
 * (or no) destination.
 *
 * Shape: "+" followed by 7-15 digits, first digit 1-9 (standard E.164).
 */
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export interface PhoneValidationResult {
  valid: boolean;
  reason?: string;
}

export function validatePhoneNumber(value: string | null | undefined): PhoneValidationResult {
  if (!value || value.trim().length === 0) {
    return { valid: false, reason: "No phone number is configured." };
  }
  if (value !== value.trim()) {
    return { valid: false, reason: "Phone number must not contain leading/trailing whitespace." };
  }
  if (!value.startsWith("+")) {
    return { valid: false, reason: "Phone number must be in E.164 format, starting with '+' and a country code." };
  }
  if (!E164_PATTERN.test(value)) {
    return {
      valid: false,
      reason: "Phone number is not a valid E.164 number (e.g. +919876543210) — only digits after '+', 8-15 digits total.",
    };
  }
  return { valid: true };
}

export function isValidE164(value: string | null | undefined): boolean {
  return validatePhoneNumber(value).valid;
}
