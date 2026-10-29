import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { JsonValue } from "@tavora/sdk";
import { emptyBoard } from "./boards";
import { noteCard } from "./cards";
import { connectorHeads } from "./connectors";
import { t } from "./i18n";
import type { PreparedPicture } from "./readPicture";

export type StarterKind = "blank" | "idea" | "screenshot";

function boardWith(elements: readonly ExcalidrawElement[]) {
  return { ...emptyBoard(), elements: JSON.parse(JSON.stringify(elements)) as JsonValue[] };
}

export function ideaBoard() {
  const main = noteCard(0, 120, t("starter.main"), t("starter.mainBody"));
  const details = noteCard(430, 0, t("starter.details"), t("starter.detailsBody"));
  const steps = noteCard(430, 270, t("starter.steps"), t("starter.stepsBody"));
  const cards = [...main, ...details, ...steps].filter((element) => element.type === "rectangle" || element.type === "text");
  return boardWith(convertToExcalidrawElements([
    ...cards,
    { type: "arrow", x: 300, y: 180, points: [[0, 0], [130, -90]], start: { id: main[0]!.id }, end: { id: details[0]!.id }, ...connectorHeads("one-way"), roughness: 0, strokeWidth: 2 },
    { type: "arrow", x: 300, y: 250, points: [[0, 0], [130, 110]], start: { id: main[0]!.id }, end: { id: steps[0]!.id }, ...connectorHeads("one-way"), roughness: 0, strokeWidth: 2 },
  ], { regenerateIds: false }));
}

export function screenshotBoard(picture: PreparedPicture, blobId: string) {
  const data = boardWith(convertToExcalidrawElements([
    { type: "image", x: 0, y: 0, width: picture.width, height: picture.height, fileId: picture.binary.id, status: "saved", locked: true },
  ]));
  data.files[picture.binary.id] = { blobId, mimeType: "image/png", created: picture.binary.created };
  return data;
}
