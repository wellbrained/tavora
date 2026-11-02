/**
 * An example's source as Show code shows it: the file, less the `defineProps<{ disabled?: boolean }>()` line that only
 * the playground's Show disabled uses, and the blank line that went with it. Nothing else changes.
 */
export function shownSource(source: string): string {
  return source.replace(/(\r?\n)\r?\ndefineProps<\{ disabled\?: boolean \}>\(\);\r?\n(?=\r?\n|<\/script>)/, "$1").trim();
}
