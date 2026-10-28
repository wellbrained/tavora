// Cards are ordinary grouped Excalidraw elements. No special document format or editor is needed.
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { FileId } from "@excalidraw/excalidraw/element/types";

export function noteCard(x: number, y: number, heading: string, body: string) {
  const groupIds = [crypto.randomUUID()];
  const elements = convertToExcalidrawElements([
    { type: "rectangle", x, y, width: 300, height: 190, backgroundColor: "#e9ecef", strokeColor: "#adb5bd", fillStyle: "solid", roughness: 0, roundness: { type: 3 }, groupIds },
    { type: "text", x: x + 20, y: y + 20, width: 260, autoResize: false, text: heading, fontSize: 22, fontFamily: 2, strokeColor: "#1b1b1f", groupIds },
    { type: "text", x: x + 20, y: y + 62, width: 260, autoResize: false, text: body, fontSize: 18, fontFamily: 2, strokeColor: "#343a40", groupIds },
  ]);
  return elements.map((element) => element.type === "rectangle" ? { ...element, height: Math.max(190, 82 + elements[2]!.height) } : element);
}

export function pictureCard(x: number, y: number, fileId: FileId, width: number, height: number, caption: string) {
  const groupIds = [crypto.randomUUID()];
  const customData = { whiteboardCard: "picture" };
  // Fit the whole picture, without stretching or cropping it.
  const scale = Math.min(300 / width, 240 / height);
  const w = width * scale;
  const h = height * scale;
  const elements = convertToExcalidrawElements([
    { type: "rectangle", x, y, width: Math.max(w, 160) + 16, height: h + 60, backgroundColor: "#f1f3f5", strokeColor: "#adb5bd", fillStyle: "solid", roughness: 0, roundness: { type: 3 }, groupIds, customData },
    { type: "image", x: x + 8, y: y + 8, width: w, height: h, fileId, status: "saved", groupIds, customData },
    { type: "text", x: x + 12, y: y + h + 22, width: Math.max(w, 160) - 8, autoResize: false, text: caption, fontSize: 18, fontFamily: 2, strokeColor: "#1b1b1f", groupIds, customData },
  ]);
  return elements.map((element) => element.type === "rectangle" ? { ...element, height: h + 32 + elements[2]!.height } : element);
}
