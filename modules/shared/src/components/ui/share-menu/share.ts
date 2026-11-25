// What the share menu's entries do: copy as text, copy as image, save as image, each saying how it went in a toast.
// The picture is made when the entries show (the menu opened), so it is ready by the click: Tavora takes a copy or a
// save only within 2 seconds of the click that asked for it. Closing the save dialog says nothing.
import { copyImage, copyText } from "../../../clipboard"
import { kitSdk } from "../../../kit-sdk"
import { uiText } from "../text"
import { toast } from "../toast/toast"

/** What the share entries take: the text, the picture and the picture's suggested file name. */
export interface ShareSource {
  /** The text Copy as text puts on the clipboard. Without it there is no Copy as text. */
  text?: () => string | Promise<string>
  /** The picture, as a PNG (`renderToImage` makes one). Without it there is no Copy as image and no Save as image. */
  image?: () => Blob | Promise<Blob>
  /** The file name Save as image suggests, without ".png". Tavora makes it safe. */
  name?: string
}

/** The entries' own words, when the defaults don't fit. */
export interface ShareLabels {
  copyText: string
  copyImage: string
  saveImage: string
}

/** One menu's share entries: `prepare` when they show, `forget` when they go, and the three actions for their rows. */
export function createShare(source: () => ShareSource) {
  let picture: Promise<Blob> | undefined

  /** Starts making the picture, so it is ready by the click. */
  function prepare(): void {
    const image = source().image
    if (!image) return
    picture = Promise.resolve().then(image)
    // A picture that fails says so when it is asked for, not before.
    picture.catch(() => {})
  }

  function forget(): void {
    picture = undefined
  }

  function pictureNow(): Promise<Blob> {
    if (!picture) prepare()
    return picture ?? Promise.reject(new Error("There is no picture to share."))
  }

  async function copyAsText(): Promise<void> {
    const text = source().text
    try {
      if (!text) throw new Error("There is no text to share.")
      await copyText(await text())
      toast({ title: uiText.value.shareCopied, variant: "success", testid: "toast-share-copied" })
    } catch {
      failed(uiText.value.shareCopyFailed)
    }
  }

  async function copyAsImage(): Promise<void> {
    try {
      await copyImage(await pictureNow())
      toast({ title: uiText.value.shareCopied, variant: "success", testid: "toast-share-copied" })
    } catch {
      failed(uiText.value.shareCopyFailed)
    } finally {
      // The next copy makes the picture again, so it shows what is there then.
      forget()
    }
  }

  async function saveAsImage(): Promise<void> {
    try {
      const saved = await savePicture(await pictureNow(), source().name)
      if (saved) toast({ title: uiText.value.shareSavedAs.replace("{name}", saved.fileName), variant: "success", testid: "toast-share-saved" })
    } catch {
      failed(uiText.value.shareSaveFailed)
    } finally {
      forget()
    }
  }

  return { prepare, forget, copyAsText, copyAsImage, saveAsImage }
}

function failed(title: string): void {
  toast({ title, description: uiText.value.shareTryAgain, variant: "error", testid: "toast-share-failed" })
}

/** Tavora's save dialog (null when the user closed it); outside Tavora, while developing, a plain download. */
async function savePicture(png: Blob, name?: string): Promise<{ fileName: string } | null> {
  const sdk = kitSdk()
  if (sdk) return sdk.pictures.save(png, name)
  const fileName = `${(name?.trim() || "Picture").replace(/\.png$/i, "")}.png`
  const link = document.createElement("a")
  link.href = URL.createObjectURL(png)
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 0)
  return { fileName }
}
