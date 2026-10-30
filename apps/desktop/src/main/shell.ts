/** What services ask of the window around them; the host answers (host.ts). */
export interface Shell {
  /** Opens Settings at one of its settings. */
  openSetting(setting: string): void;
  /** Tells the user something (Tavora's notice and a system notification). */
  notify(message: string): void;
  /** Brings Tavora's window to the front and gives it the keyboard. */
  focus(): void;
}
