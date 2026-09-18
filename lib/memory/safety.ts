// V9 — memory safety gate.
//
// Every path that can save a "What NOVA Knows" memory (the Settings UI's
// POST/PATCH handlers, and any future assistant "remember that..." action)
// must run the candidate label/value through this pure check first. NOVA is
// a personal reminder/payments app, not a credential vault: this is a
// basic, pattern-based net (not a security product) that refuses obviously
// sensitive content instead of silently storing it.

export interface MemorySafetyResult {
  ok: boolean;
  reason?: string;
}

const SENSITIVE_LABEL_RE = /\b(pass(word)?|pwd|passcode|pin|api[_ -]?key|secret[_ -]?key|access[_ -]?token|auth[_ -]?token)\b/i;

const PATTERNS: { name: string; re: RegExp }[] = [
  // Explicit labeling, e.g. "password: hunter2", "api_key=sk-...".
  { name: "password", re: /\b(pass(word)?|pwd|passcode|pin)\s*[:=]\s*\S+/i },
  { name: "api key", re: /\b(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|bearer)\s*[:=]?\s*\S+/i },
  // Common vendor API key shapes.
  { name: "api key", re: /\bsk-[A-Za-z0-9]{16,}\b/ },
  { name: "api key", re: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: "api key", re: /\bghp_[A-Za-z0-9]{20,}\b/ },
  // One-time codes / OTPs.
  { name: "one-time code", re: /\b(otp|one[- ]?time (code|password))\b\s*[:=]?\s*\d{4,8}\b/i },
  // Credit card numbers (13-19 digits, optionally grouped) that pass Luhn.
  { name: "card number", re: /\b(?:\d[ -]?){13,19}\b/ },
  // Bank routing/account style long digit-only runs labeled as such.
  { name: "bank account", re: /\b(account|routing)\s*(number|no\.?|#)?\s*[:=]?\s*\d{6,}\b/i },
  // Social security numbers.
  { name: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/ },
];

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Checks a candidate memory's label + value. Pure function, no I/O — any
 * caller (API route, assistant intent handler) must reject the save and
 * surface `reason` to the user instead of storing anything when !ok.
 */
export function checkMemorySafety(label: string, value: string): MemorySafetyResult {
  const text = `${label}\n${value}`;

  // A label that IS a sensitive field name (e.g. label="password",
  // value="hunter2" as two separate form fields, not one "key: value"
  // string) is enough on its own — the value doesn't need to look like
  // anything in particular for this to be a credential.
  if (SENSITIVE_LABEL_RE.test(label) && value.trim().length > 0) {
    return {
      ok: false,
      reason:
        "That label looks like a credential field. NOVA doesn't store passwords, keys, or other credentials as a memory.",
    };
  }

  for (const { name, re } of PATTERNS) {
    if (name === "card number") {
      const matches = text.match(re) ?? [];
      for (const m of matches) {
        const digitsOnly = m.replace(/[ -]/g, "");
        if (digitsOnly.length >= 13 && digitsOnly.length <= 19 && luhnValid(digitsOnly)) {
          return {
            ok: false,
            reason:
              "That looks like a card number. NOVA doesn't store payment credentials or other sensitive data as a memory.",
          };
        }
      }
      continue;
    }
    if (re.test(text)) {
      return {
        ok: false,
        reason: `That looks like a ${name}. NOVA doesn't store passwords, keys, or other credentials as a memory.`,
      };
    }
  }

  return { ok: true };
}
