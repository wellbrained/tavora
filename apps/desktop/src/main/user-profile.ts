import { readFile } from "node:fs/promises";
import path from "node:path";
import type { HostViewState } from "../shared/host-api";
import type { ProfileData } from "./account";
import type { Library } from "./library";
import { clipInitials, clipName, removePicture, savePicture, type Profile } from "./profile";

export interface UserProfileOptions {
  /** The profile read at start; changed in place, so whoever saves it saves the newest. */
  profile: Profile;
  /** Where the profile picture is kept (served to the host page under `pictureUrl`). */
  dir: string;
  /** The address the host page loads a picture of `dir` from. */
  pictureUrl: string;
  /** The library's settings for the profile card. */
  library: Pick<Library, "profileRanks" | "profileBanner">;
  /** Writes the profile; resolves once it is on disk. */
  save: () => Promise<void>;
  /** The account hears the profile changed, so it goes up. */
  changed: () => void;
  /** Who is signed in now (null: nobody); Undo of a removed picture checks it is still the same account. */
  accountId: () => string | null;
  /** Something the host UI shows changed. */
  pushState: () => void;
  now?: () => Date;
}

/**
 * The user's profile on this PC: name, initials and picture, what goes to the account and what comes back from it, and
 * the card the host page shows. A change is saved before it counts (the host page says "Saved" then), and the account
 * gets it after. A picture, the user's or the account's, is checked and kept in the profile folder (profile.ts); the old
 * one goes once the new one is saved.
 */
export class UserProfile {
  private readonly now: () => Date;

  constructor(private readonly options: UserProfileOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** The user named themselves. Resolves once it is on disk; the account gets it after. */
  async rename(name: string, initials: string): Promise<void> {
    const { profile } = this.options;
    profile.name = clipName(name);
    profile.initials = clipInitials(initials);
    profile.updatedAt = this.now().toISOString();
    await this.options.save();
    this.options.changed();
  }

  /** The user picked a picture (a PNG, base64), or took theirs away (null). */
  async setPicture(png: string | null): Promise<void> {
    const { profile, dir } = this.options;
    const file = png === null ? null : await savePicture(dir, png);
    const previous = profile.picture;
    profile.picture = file;
    profile.updatedAt = this.now().toISOString();
    await this.options.save();
    await removePicture(dir, previous);
    this.options.changed();
  }

  /**
   * The user took their picture away. Answers with how to give it back (for Undo), or null when there was nothing to
   * keep; that says false once another picture is there or another account is signed in.
   */
  async takePicture(): Promise<(() => Promise<boolean>) | null> {
    const { profile, dir } = this.options;
    const png = profile.picture ? await readFile(path.join(dir, profile.picture)).then((bytes) => bytes.toString("base64"), () => null) : null;
    const account = this.options.accountId();
    await this.setPicture(null);
    if (png === null) return null;
    return async () => {
      if (profile.picture !== null || this.options.accountId() !== account) return false;
      await this.setPicture(png);
      return true;
    };
  }

  /** The profile as it goes to the account: the picture as a base64 PNG. */
  async data(): Promise<ProfileData> {
    const { profile, dir } = this.options;
    const picture = profile.picture ? await readFile(path.join(dir, profile.picture)).then((bytes) => bytes.toString("base64"), () => null) : null;
    return { name: profile.name, initials: profile.initials, picture, updatedAt: profile.updatedAt };
  }

  /** Puts the account's profile in place of this PC's (its picture checked like one the user picked). */
  async apply(remote: ProfileData & { updatedAt: string }): Promise<void> {
    const { profile, dir } = this.options;
    const previous = profile.picture;
    const picture = remote.picture ? await savePicture(dir, remote.picture) : null;
    profile.name = clipName(remote.name);
    profile.initials = clipInitials(remote.initials);
    profile.picture = picture;
    profile.updatedAt = remote.updatedAt;
    await this.options.save();
    if (previous !== picture) await removePicture(dir, previous);
    this.options.pushState();
  }

  /** The profile card: without a banner chosen, a picture shows behind it, else stripes. */
  view(): HostViewState["profile"] {
    const { profile, library, pictureUrl } = this.options;
    return {
      name: profile.name,
      initials: profile.initials,
      pictureUrl: profile.picture ? pictureUrl + profile.picture : null,
      ranks: { ...library.profileRanks },
      banner: library.profileBanner ?? (profile.picture ? "picture" : "stripes"),
    };
  }
}
