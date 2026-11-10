// A site that asks for a client certificate (in the TLS handshake) gets none. Without this, Electron hands the
// Browser panel and page imports the first certificate in the user's store, with the name or email it holds.
import type { App } from "electron";

export function refuseClientCertificates(app: Pick<App, "on">): void {
  app.on("select-client-certificate", (event, _contents, _url, _list, callback) => {
    event.preventDefault();
    callback();
  });
}
