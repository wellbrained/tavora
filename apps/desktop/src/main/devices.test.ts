import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { App, Session } from "electron";
import { lockDevices, refuseBluetoothChooser, refuseDevices } from "./devices";

/** A session as far as devices go: its handlers and its chooser events. */
function fakeSession() {
  const emitter = new EventEmitter();
  type DeviceHandler = (details: { deviceType: string }) => boolean;
  type PairingHandler = (details: unknown, callback: (response: { confirmed: boolean }) => void) => void;
  const handlers: { device?: DeviceHandler; pairing?: PairingHandler } = {};
  const ses = Object.assign(emitter, {
    setDevicePermissionHandler: (handler: DeviceHandler) => (handlers.device = handler),
    setBluetoothPairingHandler: (handler: PairingHandler) => (handlers.pairing = handler),
  });
  return { ses: ses as unknown as Session, emitter, handlers };
}

const chooserEvent = () => ({ preventDefault: vi.fn() });

describe("a page's Bluetooth chooser", () => {
  it("picks no device, even with devices in range", () => {
    const contents = new EventEmitter();
    refuseBluetoothChooser(contents as never);
    const event = chooserEvent();
    const callback = vi.fn();
    contents.emit("select-bluetooth-device", event, [{ deviceId: "AA:BB", deviceName: "Headset" }], callback);
    // Without preventDefault Electron would pick the first device itself.
    expect(event.preventDefault).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith("");
  });
});

describe("a session's devices", () => {
  it("are never permitted, never paired, and every chooser finds nothing", () => {
    const { ses, emitter, handlers } = fakeSession();
    lockDevices(ses);
    for (const deviceType of ["hid", "serial", "usb", "bluetooth"]) expect(handlers.device!({ deviceType })).toBe(false);
    const paired = vi.fn();
    handlers.pairing!({ deviceId: "d", pairingKind: "confirm" }, paired);
    expect(paired).toHaveBeenCalledWith({ confirmed: false });

    const hid = chooserEvent();
    const hidCallback = vi.fn();
    emitter.emit("select-hid-device", hid, { deviceList: [{ deviceId: "1" }] }, hidCallback);
    expect(hid.preventDefault).toHaveBeenCalled();
    expect(hidCallback).toHaveBeenCalledWith();
    const serial = chooserEvent();
    const serialCallback = vi.fn();
    emitter.emit("select-serial-port", serial, [{ portId: "COM3" }], {}, serialCallback);
    expect(serial.preventDefault).toHaveBeenCalled();
    expect(serialCallback).toHaveBeenCalledWith("");
    const usb = chooserEvent();
    const usbCallback = vi.fn();
    emitter.emit("select-usb-device", usb, { deviceList: [{ deviceId: "2" }] }, usbCallback);
    expect(usb.preventDefault).toHaveBeenCalled();
    expect(usbCallback).toHaveBeenCalledWith();
  });

  it("are locked once, however often a session comes back", () => {
    const { ses, emitter } = fakeSession();
    lockDevices(ses);
    lockDevices(ses);
    expect(emitter.listenerCount("select-hid-device")).toBe(1);
    expect(emitter.listenerCount("select-serial-port")).toBe(1);
    expect(emitter.listenerCount("select-usb-device")).toBe(1);
  });
});

describe("Tavora", () => {
  it("locks every session it makes, the default one, and every page's Bluetooth chooser", async () => {
    const app = Object.assign(new EventEmitter(), { whenReady: () => Promise.resolve() });
    const fallback = fakeSession();
    refuseDevices(app as unknown as App, () => fallback.ses);
    await Promise.resolve();
    expect(fallback.handlers.device!({ deviceType: "usb" })).toBe(false);

    const made = fakeSession();
    app.emit("session-created", made.ses);
    expect(made.emitter.listenerCount("select-usb-device")).toBe(1);

    const contents = new EventEmitter();
    app.emit("web-contents-created", {}, contents);
    const event = chooserEvent();
    const callback = vi.fn();
    contents.emit("select-bluetooth-device", event, [{ deviceId: "AA:BB", deviceName: "Headset" }], callback);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith("");
  });
});
