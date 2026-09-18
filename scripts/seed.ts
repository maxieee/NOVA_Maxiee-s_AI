/**
 * Standalone seeding script. The local SQLite data layer already seeds
 * itself lazily on first access (see lib/db/seed-data.ts), so this script
 * is mainly useful to force-create the database file ahead of time, e.g.
 * in CI or before a demo.
 *
 * Usage: npm run db:seed
 */
import { db } from "../lib/db";

const userId = db.getCurrentUserId();
const reminders = db.listReminders(userId);

console.log(`NOVA local database ready at database/nova.sqlite`);
console.log(`Seeded ${reminders.length} demo reminders for user ${userId}.`);
