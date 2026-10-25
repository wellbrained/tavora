export { default as CodeInput } from "./CodeInput.vue"

/** The digits of a typed or pasted code, at most `length` of them. */
export function codeDigits(text: string, length = 6): string {
  return text.replace(/\D/g, "").slice(0, length)
}
