/** Text made safe to put into HTML, inside an element or a quoted attribute. */
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
