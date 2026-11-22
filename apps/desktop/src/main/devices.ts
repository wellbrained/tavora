// No page in Tavora gets a Bluetooth, HID, serial or USB device: Tavora offers none, so every chooser answers "no
// device", no device counts as permitted and none pairs. Electron cancels most of these by itself while nobody
// listens, but a Bluetooth chooser with a listener that doesn't call preventDefault hands the page the first device
// in range. So this answers every chooser of every session and contents itself, instead of leaning on that default.
import type { App, Session, WebContents } from "electron";

const locked = new WeakSet<Session>();

/** One session: its choosers find nothing, no device is permitted, none pairs. Safe to call again. */
export function lockDevices(ses: Session): void {
  if (locked.has(ses)) return;
  locked.add(ses);
  ses.setDevicePermissionHandler(() => false);
  // Electron asks this on Windows and Linux only.
  ses.setBluetoothPairingHandler?.((_details, callback) => callback({ confirmed: false }));
  ses.on("select-hid-device", (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
  ses.on("select-serial-port", (event, _ports, _contents, callback) => {
    event.preventDefault();
    callback("");
  });
  ses.on("select-usb-device", (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
}

/** One page's Bluetooth chooser (Electron asks the contents, not the session): it picks nothing. */
export function refuseBluetoothChooser(contents: Pick<WebContents, "on">): void {
  contents.on("select-bluetooth-device", (event, _devices, callback) => {
    event.preventDefault();
    callback("");
  });
}

/** Every session and every contents Tavora makes, the default session included. */
export function refuseDevices(app: Pick<App, "on" | "whenReady">, defaultSession: () => Session): void {
  app.on("session-created", lockDevices);
  app.on("web-contents-created", (_event, contents) => refuseBluetoothChooser(contents));
  // It may exist before this runs; locking it again does nothing.
  void app.whenReady().then(() => lockDevices(defaultSession()));
}
