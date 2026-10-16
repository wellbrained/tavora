// What the AI Usage connector reads from a profile's saved login and from the providers about
// who is signed in: the plan as a name from a fixed list, the access token for one request, and
// the email. Pure functions: nothing here touches the disk or the network. The usage windows are
// read by the AI Usage module itself (modules/ai-usage), from the answers the connector hands over.

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** An email the provider reports for the signed-in account: one plain address, no spaces, brackets, quotes or control characters. */
export function parseEmail(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 254) return null;
  return /^[A-Za-z0-9._+%'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(value) ? value : null;
}

const PLAN_NAMES: Readonly<Record<string, string>> = {
  free: "Free",
  pro: "Pro",
  plus: "Plus",
  max: "Max",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
  edu: "Edu",
  go: "Go",
};

function planName(value: unknown): string | null {
  return typeof value === "string" ? (PLAN_NAMES[value.toLowerCase()] ?? null) : null;
}

/** The plan in a Claude profile's `.credentials.json`; only a fixed list of names is ever shown. */
export function claudePlan(credentials: unknown): string | null {
  const oauth = isObject(credentials) && isObject(credentials.claudeAiOauth) ? credentials.claudeAiOauth : null;
  if (!oauth) return null;
  if (typeof oauth.subscriptionType === "string" && oauth.subscriptionType.toLowerCase() === "max") {
    if (oauth.rateLimitTier === "default_claude_max_5x") return "Max 5×";
    if (oauth.rateLimitTier === "default_claude_max_20x") return "Max 20×";
    return "Max";
  }
  return planName(oauth.subscriptionType);
}

/**
 * The plan in a Codex profile's `auth.json`: the plan claim of the saved ID
 * token. This is only a label. The token is not checked or sent anywhere.
 */
export function codexPlan(auth: unknown): string | null {
  if (!isObject(auth)) return null;
  if (auth.auth_mode === "apikey") return "API key";
  const token = isObject(auth.tokens) ? auth.tokens.id_token : null;
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const claim = isObject(claims) ? claims["https://api.openai.com/auth"] : null;
    return isObject(claim) ? planName(claim.chatgpt_plan_type) : null;
  } catch {
    return null;
  }
}

/** The access token of a Claude profile's `.credentials.json`, or null. It is used for one request and never stored. */
export function claudeAccessToken(credentials: unknown): string | null {
  const oauth = isObject(credentials) && isObject(credentials.claudeAiOauth) ? credentials.claudeAiOauth : null;
  const token = oauth?.accessToken;
  return typeof token === "string" && token.trim() !== "" && token.length <= 4096 ? token : null;
}
