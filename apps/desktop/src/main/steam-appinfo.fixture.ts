// Builds fake appinfo.vdf files in the format Steam writes, for tests.

/** Builds the pieces of an appinfo.vdf, in the format Steam writes. */
export class Bytes {
  data: number[] = [];
  u8(value: number) {
    this.data.push(value & 0xff);
    return this;
  }
  u32(value: number) {
    for (let i = 0; i < 4; i += 1) this.data.push((value >>> (8 * i)) & 0xff);
    return this;
  }
  u64(value: number) {
    this.u32(value);
    return this.u32(0);
  }
  cstr(text: string) {
    this.data.push(...new TextEncoder().encode(text), 0);
    return this;
  }
  raw(more: number[]) {
    this.data.push(...more);
    return this;
  }
  get length() {
    return this.data.length;
  }
}

export type Node = { [key: string]: string | number | Node };

/** Binary key-values: keys by table index (version 41) or inline (older). */
function writeKeyValues(out: Bytes, node: Node, key: (name: string) => void): void {
  for (const [name, value] of Object.entries(node)) {
    if (typeof value === "string") out.u8(0x01), key(name), out.cstr(value);
    else if (typeof value === "number") out.u8(0x02), key(name), out.u32(value);
    else out.u8(0x00), key(name), writeKeyValues(out, value, key);
  }
  out.u8(0x08);
}

export interface FakeApp {
  appid: number;
  common?: Node;
  /** Bytes to put in place of the key-values, to damage an entry. */
  rawKeyValues?: number[];
}

export function appInfo(version: 39 | 40 | 41, apps: FakeApp[]): Uint8Array {
  const names: string[] = [];
  const index = (name: string) => {
    let at = names.indexOf(name);
    if (at < 0) at = names.push(name) - 1;
    return at;
  };
  const out = new Bytes();
  out.u32(version | (0x075644 << 8)).u32(1);
  if (version === 41) out.u64(0);
  for (const app of apps) {
    const body = new Bytes();
    // state, update time, token, hash, change number (and, from 40, a second hash)
    body.raw(new Array(version >= 40 ? 60 : 40).fill(0));
    if (app.rawKeyValues) {
      body.raw(app.rawKeyValues);
    } else {
      const key = (name: string) => (version === 41 ? body.u32(index(name)) : body.cstr(name));
      body.u8(0x00);
      key("appinfo");
      writeKeyValues(body, { appid: app.appid, ...(app.common ? { common: app.common } : {}) }, key);
      body.u8(0x08);
    }
    out.u32(app.appid).u32(body.length).raw(body.data);
  }
  out.u32(0);
  if (version === 41) {
    const tableAt = out.length;
    out.u32(names.length);
    for (const name of names) out.cstr(name);
    out.data.splice(8, 4, ...new Bytes().u32(tableAt).data);
  }
  return new Uint8Array(out.data);
}
