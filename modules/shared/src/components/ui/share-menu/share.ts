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

/** What ShareMenu and ShareMenuSub take: the sources, and the words when the defaults don't fit (`share` is the button or row). */
export type ShareMenuProps = ShareSource & { labels?: Partial<ShareLabels & { share: string }> }

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

  /** Runs one entry's work; a toast says how it went: `done` names it, null says nothing (the save dialog was closed). */
  async function run(work: () => Promise<string | null>, failure: () => string): Promise<void> {
    try {
      const done = await work()
      if (done) toast({ title: done, variant: "success", testid: "toast-share-done" })
    } catch {
      toast({ title: failure(), description: uiText.value.shareTryAgain, variant: "error", testid: "toast-share-failed" })
    } finally {
      // The next picture is made again, so it shows what is there then.
      forget()
    }
  }

  const copyAsText = () =>
    run(async () => {
      const text = source().text
      if (!text) throw new Error("There is no text to share.")
      await copyText(await text())
      return uiText.value.shareCopied
    }, () => uiText.value.shareCopyFailed)

  const copyAsImage = () =>
    run(async () => {
      await copyImage(await pictureNow())
      return uiText.value.shareCopied
    }, () => uiText.value.shareCopyFailed)

  const saveAsImage = () =>
    run(async () => {
      const saved = await savePicture(await pictureNow(), source().name)
      return saved && uiText.value.shareSavedAs.replace("{name}", saved.fileName)
    }, () => uiText.value.shareSaveFailed)

  return { prepare, forget, copyAsText, copyAsImage, saveAsImage }
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
