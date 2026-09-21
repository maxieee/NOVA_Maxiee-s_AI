import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Regression guard for the traffic-amplification half of the
 * EMAXCONNSESSION production incident (see lib/db/supabase.ts and
 * tests/db-pool-lifecycle.test.ts for the connection-pool half).
 *
 * app/reminders/[id]/page.tsx and app/payments/[id]/page.tsx are both
 * `export const dynamic = "force-dynamic"` server components that hit the
 * database on every render. Next.js <Link> prefetches by default; a list
 * page rendering many cards that each <Link> to one of these routes (the
 * reminders list, the Today view, the payments list, the calendar month
 * grid, the history timeline) could turn one page view into many
 * concurrent, DB-hitting requests to the detail route the moment the list
 * renders — exactly the "many concurrent /reminders/[id] requests" this
 * incident's Vercel logs showed. Every such <Link> must disable prefetch.
 *
 * This is a source-scan rather than a rendered-DOM assertion because
 * `prefetch` is a Next.js router-level behavior (viewport/hover-triggered),
 * not something that shows up in server-rendered HTML output, and this
 * project has no React Testing Library / jsdom setup to inspect live
 * component props.
 */

const REPO_ROOT = join(__dirname, "..");

// Each entry: a file containing a Link to a force-dynamic detail route, and
// the literal href prefix it must pair with `prefetch={false}`.
const LINK_SITES: Array<{ file: string; hrefPrefix: string }> = [
  { file: "components/calendar/MonthGrid.tsx", hrefPrefix: "/reminders/" },
  { file: "components/dashboard/PaymentTodayCard.tsx", hrefPrefix: "/payments/" },
  { file: "components/reminders/ReminderCard.tsx", hrefPrefix: "/reminders/" },
  { file: "app/history/page.tsx", hrefPrefix: "/reminders/" },
  { file: "app/payments/page.tsx", hrefPrefix: "/payments/" },
];

/**
 * Finds every `<Link ... href={`prefix...`} ... />` (or `... >` for a
 * non-self-closing tag) block in the source and returns each one's full
 * text, so we can check `prefetch={false}` appears within the same tag
 * rather than just somewhere in the file.
 */
function findLinkTagsForHref(source: string, hrefPrefix: string): string[] {
  const matches: string[] = [];
  const linkOpenRegex = /<Link\b/g;
  let m: RegExpExecArray | null;
  while ((m = linkOpenRegex.exec(source))) {
    const tagEnd = source.indexOf(">", m.index);
    if (tagEnd === -1) continue;
    const tag = source.slice(m.index, tagEnd + 1);
    if (tag.includes(`href={\`${hrefPrefix}`) || tag.includes(`href="${hrefPrefix}`)) {
      matches.push(tag);
    }
  }
  return matches;
}

describe("Link prefetch disabled on force-dynamic, DB-hitting detail routes", () => {
  for (const { file, hrefPrefix } of LINK_SITES) {
    it(`${file}: every Link to ${hrefPrefix}[id] has prefetch={false}`, () => {
      const source = readFileSync(join(REPO_ROOT, file), "utf8");
      const tags = findLinkTagsForHref(source, hrefPrefix);

      expect(tags.length).toBeGreaterThan(0); // guards against the regex silently matching nothing
      for (const tag of tags) {
        expect(tag).toContain("prefetch={false}");
      }
    });
  }

  it("app/payments/page.tsx: both the payment-account Link and the ad-hoc-payment reminder Link disable prefetch", () => {
    const source = readFileSync(join(REPO_ROOT, "app/payments/page.tsx"), "utf8");
    const paymentLinks = findLinkTagsForHref(source, "/payments/");
    const reminderLinks = findLinkTagsForHref(source, "/reminders/");

    expect(paymentLinks.length).toBeGreaterThan(0);
    expect(reminderLinks.length).toBeGreaterThan(0);
    for (const tag of [...paymentLinks, ...reminderLinks]) {
      expect(tag).toContain("prefetch={false}");
    }
  });
});
