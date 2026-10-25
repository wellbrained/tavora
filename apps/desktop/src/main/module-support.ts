// A module's support link (manifest `support`): an https address or an email address. The host opens it only
// after a click and only in these two forms, so a module's text can never open anything else.
import { isSupportEmail, isSupportLink } from "@tavora/module-schema";
import { isWebUrl } from "./browser-url";

export type SupportTarget = { kind: "web"; url: string } | { kind: "mail"; url: string };

/** What to open for a support link, or null when it is neither a valid https address nor a plain email address. */
export function supportTarget(link: string): SupportTarget | null {
  if (!isSupportLink(link)) return null;
  if (isSupportEmail(link)) return { kind: "mail", url: `mailto:${link}` };
  return isWebUrl(link) ? { kind: "web", url: link } : null;
}
