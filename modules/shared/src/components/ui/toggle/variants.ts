/**
 * The look of one toggle button, alone or in a group: a 32px square, accent-tinted while pressed. The colours change on
 * the press token and the button dips a little under a mouse press, like a Button (fine pointer, motion allowed, not off).
 */
export const toggleClass =
  "border-input text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-ring data-[state=on]:border-primary/50 data-[state=on]:bg-primary/15 data-[state=on]:text-primary relative inline-flex size-8 flex-none items-center justify-center border text-sm transition-[color,background-color,border-color,scale] duration-(--duration-press) ease-(--ease-out-strong) [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-disabled:active:scale-90 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50"
