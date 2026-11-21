/**
 * What the picture of a panel in its own dialog is sent under, beside the pictures of the panels' slots. It stands in for
 * the page while a menu is open over the dialog. Instance ids have no colon, so it can't be taken for a slot's.
 */
export const dialogPictureKey = (instanceId: string) => `dialog:${instanceId}`;
