import { ref, shallowRef } from "vue";

// The admin token is asked for once per browser session and sent with every call. Never stored longer.
const KEY = "adminToken";
export const token = ref(sessionStorage.getItem(KEY) ?? "");

export class WrongToken extends Error {
  constructor() {
    super("Wrong token.");
  }
}

export function setToken(value: string): void {
  token.value = value;
  if (value) sessionStorage.setItem(KEY, value);
  else sessionStorage.removeItem(KEY);
}

/** A call to the API; a refused token clears the saved one and shows the sign-in again. */
export async function call(path: string, body?: unknown, cache: RequestCache = "no-store"): Promise<Response> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-Admin-Token": token.value, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache,
  });
  if (response.status === 401) {
    setToken("");
    throw new WrongToken();
  }
  return response;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await call(path);
  if (!response.ok) throw new Error(`Can't load ${path}.`);
  return (await response.json()) as T;
}

/** An action: POST JSON. An answer with an error message is thrown. */
export async function act(path: string, body: unknown): Promise<void> {
  const response = await call(path, body);
  if (!response.ok) {
    const failed = ((await response.json().catch(() => ({}))) as { error?: string }).error;
    throw new Error(failed ?? "That didn't work.");
  }
}

export const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** One page of data: loads on demand, keeps the last answer, and says if loading failed. */
export function resource<T>(path: string) {
  const data = shallowRef<T | null>(null);
  const error = ref("");
  const loading = ref(false);
  async function reload(): Promise<void> {
    loading.value = true;
    try {
      data.value = await getJson<T>(path);
      error.value = "";
    } catch (failure) {
      if (!(failure instanceof WrongToken)) error.value = message(failure);
    } finally {
      loading.value = false;
    }
  }
  return { data, error, loading, reload };
}

// Pictures need the token, which an image tag cannot send: fetch them and show them from blob addresses.
const pictures = new Map<string, Promise<string>>();

export function picture(path: string): Promise<string> {
  let url = pictures.get(path);
  if (!url) {
    // A hosted picture may come from the browser's cache (its address names its hash); an offered one never does.
    const next = call(path, undefined, path.startsWith("/api/hosted/") ? "default" : "no-store")
      .then(async (response) => (response.ok ? URL.createObjectURL(await response.blob()) : ""))
      .catch(() => "");
    void next.then((value) => {
      if (!value && pictures.get(path) === next) pictures.delete(path);
    });
    pictures.set(path, next);
    url = next;
  }
  return url;
}

/** Lets go of the pictures nothing shows any more. */
export function keepPictures(wanted: Set<string>): void {
  for (const [path, url] of pictures) {
    if (wanted.has(path)) continue;
    pictures.delete(path);
    void url.then((value) => value && URL.revokeObjectURL(value));
  }
}
