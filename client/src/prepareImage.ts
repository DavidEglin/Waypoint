import { MAX_IMAGE_BYTES } from '@waypoint/shared';

const TARGET_BYTES = MAX_IMAGE_BYTES - 512 * 1024;
const MAX_SIDE = 2400;

/**
 * Phone photos are often 5 MB or more, which is over Claude's image limit. Shrink big ones to a
 * JPEG in the browser before uploading (this also makes the upload faster). Anything that cannot be
 * decoded here is returned unchanged and the server decides.
 */
export async function prepareImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= TARGET_BYTES) return file;
  try {
    // imageOrientation keeps phone photos the right way up.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    for (const [side, quality] of [[MAX_SIDE, 0.85], [MAX_SIDE, 0.7], [1800, 0.7], [1400, 0.6]] as const) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= TARGET_BYTES) {
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
      }
    }
  } catch {
    /* fall through: send the original */
  }
  return file;
}
