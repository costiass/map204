/**
 * Turns an uploaded image into a data URL small enough to live in localStorage.
 * Large photos are downscaled to `maxWidth` and re-encoded as JPEG; anything
 * that cannot be decoded (e.g. SVG) falls back to the raw data URL.
 */
export async function fileToDataUrl(file: File, maxWidth = 900, quality = 0.82): Promise<string> {
  const rawUrl = await readAsDataUrl(file)

  if (file.type === 'image/svg+xml' || !file.type.startsWith('image/')) {
    return rawUrl
  }

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxWidth / bitmap.width)
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return rawUrl
    // JPEG has no alpha, so transparent pixels would come out black. Notes are
    // read on white, so flatten onto white first.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return rawUrl
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
