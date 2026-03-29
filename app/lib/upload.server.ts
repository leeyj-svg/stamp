import axios from "axios";
import sharp from "sharp";
import exifr from "exifr";
// 1. 환경 변수 체크
const ENV_UPLOAD_URL = process.env.STORAGE_SERVER_URL || "";
const INTERNAL_HOST = "http://192.168.0.200:4000";
const PUBLIC_VIEW_ROOT = "https://img.tcroom.kr";
interface ExifrOutput {
  DateTimeOriginal?: Date | string;
  CreateDate?: Date | string;
  ModifyDate?: Date | string;
  DateCreated?: Date | string; // XMP에서 주로 사용
  DateTime?: Date | string;
  [key: string]: unknown;
}
export async function processAndUploadImage(file: File): Promise<{ url: string; takenAt: Date | null } | null> {
  if (!file || file.size === 0) return null;
  if (!ENV_UPLOAD_URL) return null;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let takenAt: Date | null = null;

    // --- [Step 1] exifr로 메타데이터 추출 (PNG/XMP 지원) ---
    try {
      // exifr는 buffer를 직접 받아서 파싱합니다.
      // mergeOutput: false로 하면 exif, xmp 등이 분리되지만, true(기본값)면 합쳐져서 찾기 편합니다.
      const metadata = await exifr.parse(buffer, {
        tiff: true,
        xmp: true,  // ✨ PNG는 XMP에 날짜가 있을 확률이 높음
        icc: false,
        iptc: true,
        jfif: true,
      }) as ExifrOutput | undefined;

      if (metadata) {

        // 날짜 후보군 (우선순위 순)
        const candidates = [
          metadata.DateTimeOriginal,
          metadata.CreateDate,
          metadata.DateCreated, // XMP에서 날짜 저장하는 필드
          metadata.DateTime,
          metadata.ModifyDate
        ];

        for (const dateRaw of candidates) {
          if (!dateRaw) continue;

          // exifr는 설정을 안 건드리면 Date 객체로 자동 변환해서 주는 경우가 많음
          if (dateRaw instanceof Date) {
            takenAt = dateRaw;
            break;
          }

          // 문자열로 들어온 경우 파싱
          if (typeof dateRaw === 'string') {
            // ISO 포맷 변환 (2022:09:17 -> 2022-09-17)
            const isoString = dateRaw.replace(/^(\d{4})[:.](\d{2})[:.](\d{2})/, '$1-$2-$3');
            const parsedDate = new Date(isoString);
            if (!isNaN(parsedDate.getTime())) {
              takenAt = parsedDate;
              break;
            }
          }
        }
      } else {
        console.log("⚠️ [EXIF] 메타데이터가 발견되지 않음");
      }
    } catch (e: unknown) {
      console.warn(`⚠️ 메타데이터 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
    }

    // --- [Step 2] Fallback (파일 수정일) ---
    if (!takenAt) {
      console.warn("⚠️ [최종 경고] 메타데이터 없음. 파일의 lastModified 사용.");
      takenAt = new Date(file.lastModified || Date.now());
    }

    // --- [Step 3] 이미지 리사이징 및 업로드 (기존과 동일) ---
    const optimizedBuffer = await sharp(buffer)
      .rotate()
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const filename = `image-${Date.now()}-${Math.round(Math.random() * 1E9)}.webp`;
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(optimizedBuffer)], { type: 'image/webp' });
    formData.append('file', blob, filename);

    const urlObj = new URL(ENV_UPLOAD_URL);
    const { data } = await axios.post(`${INTERNAL_HOST}${urlObj.pathname}`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60000
    });

    if (data.success) {
      return { url: `${PUBLIC_VIEW_ROOT}${data.url}`, takenAt };
    }
    return null;

  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      console.error("👉 [Upload Error]", error.message);
    } else if (error instanceof Error) {
      console.error("👉 [Error]", error.message);
    }
    return null;
  }
}
// ... 나머지 함수들(uploadImages, deleteImage 등)은 그대로 두셔도 됩니다.
export async function uploadImages(files: File[]): Promise<{ url: string; takenAt: Date | null }[]> {
  const uploadPromises = files.map(file => processAndUploadImage(file));
  const results = await Promise.all(uploadPromises);

  // 결과가 null이 아닌 것만 필터링하고, 타입스크립트에게 구체적인 객체 형태임을 알려줍니다.
return results.filter((result): result is { url: string; takenAt: Date | null } => result !== null);
}

export function isStorageUploadAvailable() {
  return Boolean(ENV_UPLOAD_URL);
}

export async function uploadFileToStorage(file: File): Promise<{ url: string; mimeType: string | null; byteSize: number } | null> {
  if (!file || file.size === 0) return null;
  if (!ENV_UPLOAD_URL) return null;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const safeOriginalName = (file.name || "file")
      .replace(/[^\w.\-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "file";
    const filename = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${safeOriginalName}`;

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: file.type || "application/octet-stream" });
    formData.append("file", blob, filename);

    const urlObj = new URL(ENV_UPLOAD_URL);
    const { data } = await axios.post(`${INTERNAL_HOST}${urlObj.pathname}`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60000,
    });

    if (!data.success) {
      return null;
    }

    return {
      url: `${PUBLIC_VIEW_ROOT}${data.url}`,
      mimeType: file.type || null,
      byteSize: file.size,
    };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      console.error("[File Upload Error]", error.message);
    } else if (error instanceof Error) {
      console.error("[File Upload Error]", error.message);
    }
    return null;
  }
}

export async function deleteImage(fullUrl: string) {
  if (!fullUrl) return;
  try {
    const urlObj = new URL(fullUrl);
    const pathOnly = urlObj.pathname;
    await axios.delete(`${INTERNAL_HOST}/delete`, { data: { path: pathOnly } });
  } catch (error) {
    console.error(`이미지 삭제 실패 (${fullUrl}):`, error);
  }
}

export async function deleteImages(urls: string[]) {
  await Promise.all(urls.map(url => deleteImage(url)));
}
