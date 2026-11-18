const MAX_FILE_BYTES = 15_000_000;
const MAX_DATA_URL_LENGTH = 1_100_000;

/** Resize and re-encode seller photos so phone camera originals fit the JSON upload limit. */
export async function prepareListingPhoto(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('이미지 파일을 선택해 주세요.');
  if (file.size > MAX_FILE_BYTES) throw new Error('사진은 15MB 이하로 선택해 주세요.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('사진을 열 수 없습니다. JPG, PNG 또는 WebP 사진을 선택해 주세요.'); }
  try {
    for (const size of [1400, 1100]) {
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('사진을 처리할 수 없습니다.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.8, 0.68, 0.55]) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (dataUrl.length <= MAX_DATA_URL_LENGTH) return dataUrl;
      }
    }
    throw new Error('사진 용량을 줄일 수 없습니다. 다른 사진을 선택해 주세요.');
  } finally { bitmap.close?.(); }
}
