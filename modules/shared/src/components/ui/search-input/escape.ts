/**
 * Whether Escape in a search field clears it: only while there is text. On an empty field Escape is left alone, so
 * it can still close the popover or dialog around the field.
 */
export const clearsOnEscape = (value: string | number | undefined | null): boolean => String(value ?? "") !== ""
