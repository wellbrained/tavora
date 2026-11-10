import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import type { App } from "electron";
import { refuseClientCertificates } from "./client-certificates";

it("sends no client certificate, even when the store has some", () => {
  const app = new EventEmitter();
  refuseClientCertificates(app as unknown as App);
  const event = { preventDefault: vi.fn() };
  const callback = vi.fn();
  app.emit("select-client-certificate", event, {}, "https://site.test/", [{ subjectName: "me@example.com" }], callback);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(callback).toHaveBeenCalledWith();
});
