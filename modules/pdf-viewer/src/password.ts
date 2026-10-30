// Answers pdf.js when a PDF asks for its password. The password goes straight to pdf.js and is never kept.

/** Asks the reader for the password (`wrong`: the last one did not open it); null when they cancel. */
export type AskPassword = (wrong: boolean) => Promise<string | null>;

/** A pdf.js `onPassword` handler: asks, then opens with the answer, or cancels the opening. */
export function passwordAnswerer(ask: AskPassword, isWrong: (reason: number) => boolean, cancel: () => void) {
  return (update: (password: string) => void, reason: number) => {
    void ask(isWrong(reason)).then((password) => (password === null ? cancel() : update(password)), cancel);
  };
}
