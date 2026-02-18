import { expect, test } from "vitest";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

test("SEC-301: users table stores only ssn_last4 and does not have ssn", () => {
  const dbPath = path.join(process.cwd(), "bank.db");

  if (!fs.existsSync(dbPath)) {
    throw new Error("bank.db not found. Start the app once to create it (npm run dev).");
  }

  const db = new Database(dbPath);

  const cols = db.prepare("PRAGMA table_info(users);").all();
  const names = cols.map((c) => c.name);

  expect(names).toContain("ssn_last4");
  expect(names).not.toContain("ssn");

  db.close();
});
