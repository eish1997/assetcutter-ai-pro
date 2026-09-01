/** Current preview differs from the on-disk checkout file. */
export function workshopDisplayNeedsApply(faceFileId: string, checkoutFileId: string): boolean {
  const face = String(faceFileId || '').trim();
  const checkout = String(checkoutFileId || '').trim();
  return Boolean(face && checkout && face !== checkout);
}
