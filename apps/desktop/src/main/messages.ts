import { translate, type MessageKey, type Params } from "../shared/i18n";

/**
 * An error the player reads. It carries the key of its text, so the host can
 * word it in the player's language; `message` is English, for logs and tests.
 */
export class PlayerError extends Error {
  readonly key: MessageKey;
  readonly params: Params | undefined;

  constructor(key: MessageKey, params?: Params) {
    super(translate("en", key, params));
    this.key = key;
    this.params = params;
  }
}
