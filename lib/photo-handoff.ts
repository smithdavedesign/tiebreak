// Photos a preview tool hands to the new-poll form in the same tab (GROWTH.md, 2026-10-21). "Let strangers
// pick" uploads them and opens /?photo=<id>…; the form finds each file here by its path on tiebreak, to draw
// its thumbnail, because an upload isn't served until a poll uses it. Memory only: after a reload, or in a
// new tab, the map is empty and the form names the photo instead of drawing it. Written only from click
// handlers, so it stays empty on the server.
const handedOff = new Map<string, File>()

export function handOver(path: string, file: File) {
  handedOff.set(path, file)
}

export function handedOver(path: string): File | null {
  return handedOff.get(path) ?? null
}
