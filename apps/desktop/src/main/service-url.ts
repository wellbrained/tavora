// Where Tavora's service is: the one place that decides the address and trims it, so no caller does.

/** The Tavora service. The app talks to no one else; the desktop never holds keys. */
export const DEFAULT_API_URL = "https://api.mytavora.app";

/** A service address without its trailing slashes; left out, Tavora's own service. */
export function serviceUrl(base?: string): string {
  return (base ?? DEFAULT_API_URL).replace(/\/+$/, "");
}

/** The addresses a run can override (development and tests); the account service may live elsewhere than the rest. */
export interface ServiceAddresses {
  apiUrl?: string | undefined;
  accountUrl?: string | undefined;
}

/** The account service, ending in /v1/account (sign-in, the cloud copy, pairing). */
export function accountServiceUrl(addresses: ServiceAddresses): string {
  return `${serviceUrl(addresses.accountUrl ?? addresses.apiUrl)}/v1/account`;
}
