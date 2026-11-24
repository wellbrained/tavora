export interface ProfileDraft {
  name: string;
  initials: string;
}

/**
 * The draft after the real profile went from `was` to `now`: a field the user had not touched (it still showed the old
 * value) follows the new profile, a field they typed in stays.
 */
export function followProfile(draft: ProfileDraft, was: ProfileDraft, now: ProfileDraft): ProfileDraft {
  const name = draft.name === was.name ? now.name : draft.name;
  const initials = draft.initials === was.initials ? now.initials : draft.initials;
  return name === draft.name && initials === draft.initials ? draft : { name, initials };
}
