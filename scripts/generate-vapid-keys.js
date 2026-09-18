#!/usr/bin/env node
/**
 * Generates a fresh VAPID keypair for Web Push, using the same `web-push`
 * package the app uses to send notifications. Run once and paste the
 * output into .env.local (never commit real keys).
 *
 * Usage: npm run vapid:generate
 */
/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, no bundler */
const webpush = require("web-push");

const keys = webpush.generateVAPIDKeys();

console.log("Add these to your .env.local:\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_SUBJECT=mailto:you@example.com`);
