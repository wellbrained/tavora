import { TavoraError, type TavoraSDK } from "@tavora/sdk";
import { describe, expect, it } from "vitest";
import { pickPictures } from "./pickPictures";

/** The SDK's file calls, with `picked` as what the user chose in Tavora's dialog. */
function fakeSdk(picked: { id: string; name: string; size: number }[] | Error) {
  const calls: string[] = [];
  const sdk = {
    files: {
      pickReadOnly: async (options: { extensions: string[]; multiple?: boolean }) => {
        calls.push(`pick ${options.extensions.join(",")}${options.multiple ? " multiple" : ""}`);
        if (picked instanceof Error) throw picked;
        return options.multiple ? picked : (picked[0] ?? null);
      },
      read: async (id: string) => (calls.push(`read ${id}`), new Uint8Array([1, 2, 3])),
      forget: async (id: string) => void calls.push(`forget ${id}`),
    },
  } as unknown as TavoraSDK;
  return { sdk, calls };
}

describe("pickPictures", () => {
  it("reads what the user picked in Tavora's dialog once, and forgets the link", async () => {
    const { sdk, calls } = fakeSdk([
      { id: "a", name: "Map.PNG", size: 3 },
      { id: "b", name: "shot.jpg", size: 3 },
    ]);
    const files = (await pickPictures(sdk, true))!;
    expect(files.map((file) => [file.name, file.type, file.size])).toEqual([
      ["Map.PNG", "image/png", 3],
      ["shot.jpg", "image/jpeg", 3],
    ]);
    expect(calls).toEqual(["pick png,jpg,jpeg,gif,webp multiple", "read a", "read b", "forget a", "forget b"]);
  });

  it("is empty when the dialog was closed, and null on a Tavora without it", async () => {
    expect(await pickPictures(fakeSdk([]).sdk, false)).toEqual([]);
    expect(await pickPictures(fakeSdk(new TavoraError({ code: "UNKNOWN_METHOD", message: "files.pickReadOnly" })).sdk, false)).toBeNull();
    await expect(pickPictures(fakeSdk(new TavoraError({ code: "PERMISSION_DENIED", message: "no press" })).sdk, false)).rejects.toThrow();
  });
});
