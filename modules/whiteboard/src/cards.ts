// Cards are ordinary grouped Excalidraw elements. No special document format or editor is needed.
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawTextElement, FileId } from "@excalidraw/excalidraw/element/types";

// Scene colours work with Excalidraw's light/dark filter and remain editable with its usual style palette.
const CARD_STYLE = { strokeColor: "#d6cfc1", strokeWidth: 1, fillStyle: "solid" as const, roughness: 0, roundness: { type: 3 as const, value: 8 } };
const HEADING = "#26231e";
const BODY = "#514b40";
const BODY_LINE_HEIGHT = 1.5 as ExcalidrawTextElement["lineHeight"];

export function noteCard(x: number, y: number, heading: string, body: string) {
  const groupIds = [crypto.randomUUID()];
  const elements = convertToExcalidrawElements([
    { type: "rectangle", x, y, width: 300, height: 190, backgroundColor: "#f5f0e4", ...CARD_STYLE, groupIds },
    { type: "text", x: x + 20, y: y + 20, width: 260, autoResize: false, text: heading, fontSize: 24, fontFamily: 2, strokeColor: HEADING, groupIds },
    { type: "text", x: x + 20, y: y + 62, width: 260, autoResize: false, text: body, fontSize: 17, fontFamily: 2, lineHeight: BODY_LINE_HEIGHT, strokeColor: BODY, groupIds },
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
    { type: "rectangle", x, y, width: Math.max(w, 160) + 24, height: h + 64, backgroundColor: "#f1eee8", ...CARD_STYLE, groupIds, customData },
    { type: "image", x: x + 12, y: y + 12, width: w, height: h, fileId, status: "saved", groupIds, customData },
    { type: "text", x: x + 16, y: y + h + 28, width: Math.max(w, 160) - 8, autoResize: false, text: caption, fontSize: 16, fontFamily: 2, lineHeight: BODY_LINE_HEIGHT, strokeColor: BODY, groupIds, customData },
  ]);
  return elements.map((element) => element.type === "rectangle" ? { ...element, height: h + 40 + elements[2]!.height } : element);
}
