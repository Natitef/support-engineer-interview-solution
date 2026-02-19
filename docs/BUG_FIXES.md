# SecureBank — Bug Fixes & Investigation Notes

This document summarizes the reported issues I investigated, their root causes, fixes, verification steps, and preventive measures.

## Prioritization Approach
I prioritized issues using this order:
1) **Security & compliance** (risk of data exposure, account takeover, XSS)
2) **Financial correctness** (balances, missing transactions, incorrect displays)
3) **Reliability & performance** (resource leaks, slowdowns)
4) **Validation & UX polish** (input validation, dark mode styling)

Within each category, I addressed **Critical** tickets first, then **High**, then **Medium**. 

## SEC-301: SSN Stored in Plaintext (Critical)

### Root Cause
- During signup, the server wrote the incoming request object straight into the `users` table. Since the payload includes `ssn`, it was saved to SQLite as plaintext.
- The database bootstrap in `initDb` (`lib/db/index.ts`) also created the `users` table with an `ssn` column, so new databases defaulted to storing full SSNs.
### Fix
- Removed the plaintext `ssn` field from the `users` schema and replaced it with `ssn_last4` (`ssnLast4` in Drizzle).
- Updated the signup flow to derive `ssnLast4` from the submitted SSN and persist only that value (explicit insert fields; no spreading the full input object).
- Updated the `initDb` SQL to create `ssn_last4` instead of `ssn` so fresh databases are created with the correct schema.
- Recreated `bank.db` locally so the updated schema was applied.


### Preventive Measures
- Don’t pass raw request objects directly into database inserts—explicitly whitelist the fields you intend to store.
- Avoid maintaining two independent schema definitions; use migrations and a single source of truth to prevent drift.
- Add regression coverage (tests or checks) to ensure sensitive fields like SSN are never persisted in plaintext.

### Tests
- `tests/sec-301.test.js`: Verifies the database schema contains `ssn_last4` and does not contain `ssn`.


## SEC-303: XSS Vulnerability (Critical)

### Root Cause
- Transaction descriptions were rendered using `dangerouslySetInnerHTML`, treating stored/user-influenced description text as HTML.

### Fix
- Removed `dangerouslySetInnerHTML` and rendered the description as plain text, preventing HTML/script execution.


### Preventive Measures
- Avoid `dangerouslySetInnerHTML` for untrusted content.
- If rich text is required, sanitize using a proven sanitizer with a strict allowlist (and keep sanitization server-side where possible).


## SEC-302: Insecure Random Numbers (High)

### Root Cause
- Account numbers were generated using `Math.random()`, which is not cryptographically secure and can be predictable.

### Fix
- Replaced `Math.random()` with `crypto.randomInt()` to use a  secure random number generator.
- Kept the same 10-digit, zero-padded account number format to avoid breaking UI expectations.


### Preventive Measures
- Avoid non-cryptographic randomness (`Math.random()`) for any security-relevant identifiers or tokens.


## VAL-202: Date of Birth Validation (Critical)

### Root Cause
- Signup validation accepted any string for `dateOfBirth`, so future dates and underage users could be submitted and stored.

### Fix
- Added server-side validation to `dateOfBirth` to:
  - reject invalid dates
  - reject dates in the future
  - enforce a minimum age of 18

### Preventive Measures
- Keep critical validation rules server-side (client validation is helpful but not sufficient).
- Add tests for boundary cases (future DOB, exactly 18, under 18).
- Consider improving UI error rendering to display field-level messages cleanly.

