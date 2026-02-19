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
- Improved error rendering so server validation failures display as readable messages instead of a JSON blob.

### Preventive Measures
- Keep critical validation rules server-side (client validation is helpful but not sufficient).
- Add tests for boundary cases (future DOB, exactly 18, under 18).
- Consider improving UI error rendering to display field-level messages cleanly.

## SEC-304: Session Management (High)

### Root Cause
- The app created a new session record on every login/signup without invalidating older sessions.
- As a result, a single user could have multiple active sessions at the same time (e.g., logging in from different browsers/devices).
- The client UI could still appear “logged in” in a stale browser because the cookie remains in that browser even after the server invalidates the session.

### Fix
- Enforced **single active session per user**:
  - On **signup**: delete any existing sessions for the user before inserting the new session.
  - On **login**: delete any existing sessions for the user before inserting the new session.
- This ensures only the most recent login remains valid.

### Notes
- A browser that had a prior session may still display some pages until it makes a protected API call or refreshes. This is expected because that browser still holds an old cookie, but the server rejects it once checked.

### Preventive Measures
- Centralize session lifecycle behavior (create/invalidate) so it cannot drift between signup/login flows.
- Add a regression test for “login twice → only one session row exists for the user”.
- Optionally improve UX by redirecting to `/login` on `UNAUTHORIZED` responses to make stale sessions look like a logout immediately.

## PERF-405: Missing Transactions (Critical)

### Root Cause
- After funding, the UI continued showing cached `getTransactions` and `getAccounts` query results.
- Because the queries weren’t invalidated/refetched, new transactions and updated balances only appeared after a manual page refresh.

### Fix
- Added query invalidation on successful funding:
  - Invalidate `account.getTransactions` for the funded account
  - Invalidate `account.getAccounts` to refresh balances


### Preventive Measures
- Add a standard pattern for mutations that affect cached data (invalidate related queries in `onSuccess`).
- Consider optimistic updates for a smoother UX on high-frequency actions like funding.


## VAL-208: Weak Password Requirements (Critical)

### Root Cause
- Password validation was too weak (length-only / minimal checks), allowing easily guessable passwords.
- In the multi-step signup form, password issues were not surfaced until final submission, creating poor UX.

### Fix
- Strengthened server-side password validation to require complexity (uppercase, lowercase, number, special character) and a stronger minimum length.
- Mirrored the same validation rules client-side.
- Improved error rendering so server validation failures display as readable messages instead of a JSON blob.


### Preventive Measures
- Keep password policy enforced server-side and covered by tests.
- Reuse a shared validation helper (or schema) to keep client/server rules consistent.

## PERF-406: Balance Calculation (Critical)

### Root Cause
- The funding flow updated the database balance correctly, but returned a separately computed `newBalance` using repeated floating-point additions.
- This caused the UI to display balances that could diverge from the persisted value over time.

### Fix
- Removed the artificial loop-based balance calculation.
- Returned the persisted balance by reading the updated account record after the update.

### Preventive Measures
- Store money in integer cents or fixed-precision decimals to avoid floating-point drift.
- Add regression checks that compare returned balance vs. stored balance after repeated deposits.

## PERF-401: Account Creation Error (Critical)

### Root Cause
- `createAccount` returned a fabricated fallback account object when the DB fetch failed, including a hardcoded `$100` balance.
- This masked persistence failures and displayed incorrect balances to the user.

### Fix
- Removed the fallback object entirely.
- If the created account cannot be retrieved after insertion, return a server error instead of inventing account data.


### Preventive Measures
- Avoid returning fabricated domain objects on failure paths, especially in financial systems.
- Prefer transactions and explicit error handling for multi-step DB operations.
- Add regression tests that simulate DB failures and assert no fake accounts are returned.

## VAL-206: Card Number Validation (Critical)

### Root Cause
- Card number validation relied on basic formatting/prefix checks and did not verify whether a card number was mathematically valid.
- This allowed invalid card numbers to be submitted, leading to failed funding attempts and avoidable transaction errors.

### Fix
- Implemented proper card number validation using the Luhn checksum algorithm for card funding.
- Updated client-side card input validation to reject non-Luhn card numbers.

### Preventive Measures
- Keep payment validation enforced server-side so it cannot be bypassed by a modified client.
- Add regression coverage for known valid/invalid test card numbers (Luhn pass/fail cases).
- Avoid simplistic prefix-only validation; use checksum validation as a baseline and expand with brand/BIN rules if business requirements demand it.

## PERF-408: Resource Leak (Critical)

### Root Cause
- The database layer opened additional SQLite connections during initialization (`new Database(dbPath)` inside `initDb`) and stored them without ever closing them.
- In Next.js development mode, module reloads (hot reload / Turbopack) caused that initialization path to run repeatedly, which could accumulate open database handles over time.

### Fix
- Removed the extra per-init connection creation and used a single SQLite connection for both Drizzle and the table bootstrap.
- Implemented a dev-safe singleton using `globalThis` so hot reloads reuse the same SQLite handle instead of creating new connections.

### Preventive Measures
- Avoid creating database connections inside initialization helpers unless they are explicitly closed.
- Use a single connection per process for SQLite and enforce a singleton pattern in dev to avoid hot-reload leaks.
- Add lightweight monitoring/debug checks for open handles during development to catch regressions early.




