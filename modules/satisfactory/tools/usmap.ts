// The game ships its type mappings (FactoryGame.usmap) with optional properties written
// without an inner type, while CUE4Parse reads an inner type after every optional property
// and then loses its place. This walks the file and gives each optional property an inner
// type, so the reader stays aligned. Only test and editor structs use optional properties;
// none of the assets the exporter reads (textures, research trees) contain them.

const MAGIC = 0x30c4;
const VERSION_PACKAGE_VERSIONING = 1;
const VERSION_LONG_FNAME = 2;
const VERSION_LARGE_ENUMS = 3;
const VERSION_EXPLICIT_ENUM_VALUES = 4;

// EPropertyType values in the usmap format.
const BOOL = 1;
const ARRAY = 8;
const STRUCT = 9;
const MAP = 24;
const SET = 25;
const ENUM = 26;
const OPTIONAL = 28;
const LAST_KNOWN_TYPE = 30;

export interface UsmapPatch {
  bytes: Uint8Array;
  /** How many optional properties received an inner type. */
  patched: number;
}

export function patchUsmap(input: Uint8Array): UsmapPatch {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let at = 0;
  const u8 = () => view.getUint8(at++);
  const u16 = () => ((at += 2), view.getUint16(at - 2, true));
  const u32 = () => ((at += 4), view.getUint32(at - 4, true));

  if (u16() !== MAGIC) throw new Error("Not a usmap file.");
  const version = u8();
  if (version > VERSION_EXPLICIT_ENUM_VALUES) throw new Error(`Unknown usmap version ${version}.`);
  if (version >= VERSION_PACKAGE_VERSIONING && u32() !== 0) {
    at += 8; // UE4 and UE5 package file versions
    const customVersions = u32();
    at += customVersions * 20 + 4; // GUID and version each, then the changelist
  }
  const header = at;
  const method = u8();
  if (method !== 0) throw new Error(`Compressed usmap files (method ${method}) are not supported.`);
  const compressedSize = u32();
  const size = u32();
  if (compressedSize !== size) throw new Error("Usmap sizes disagree.");
  const body = at;

  const names = u32();
  for (let i = 0; i < names; i++) {
    const length = version >= VERSION_LONG_FNAME ? u16() : u8();
    at += length;
  }
  const enums = u32();
  for (let i = 0; i < enums; i++) {
    at += 4;
    const entries = version >= VERSION_LARGE_ENUMS ? u16() : u8();
    at += entries * (version >= VERSION_EXPLICIT_ENUM_VALUES ? 12 : 4);
  }

  const inserts: number[] = [];
  const property = (): void => {
    const type = u8();
    if (type > LAST_KNOWN_TYPE) throw new Error(`Unknown usmap property type ${type} at byte ${at - 1}.`);
    if (type === STRUCT) at += 4;
    else if (type === ENUM) (property(), (at += 4));
    else if (type === ARRAY || type === SET) property();
    else if (type === MAP) (property(), property());
    else if (type === OPTIONAL) inserts.push(at);
  };
  const structs = u32();
  for (let i = 0; i < structs; i++) {
    at += 8; // name and super name
    u16(); // property count, including array slots
    const serialized = u16();
    for (let j = 0; j < serialized; j++) {
      at += 7; // schema index, array size and name
      property();
    }
  }
  if (at > body + size) throw new Error("Usmap ended inside the struct table.");

  const bytes = new Uint8Array(input.byteLength + inserts.length);
  let from = 0;
  let to = 0;
  for (const insert of inserts) {
    bytes.set(input.subarray(from, insert), to);
    to += insert - from;
    bytes[to++] = BOOL;
    from = insert;
  }
  bytes.set(input.subarray(from), to);
  const out = new DataView(bytes.buffer);
  out.setUint32(header + 1, compressedSize + inserts.length, true);
  out.setUint32(header + 5, size + inserts.length, true);
  return { bytes, patched: inserts.length };
}
