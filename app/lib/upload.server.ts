import axios from "axios";
import sharp from "sharp";
import exifr from "exifr";
// 1. 환경 변수 체크
const ENV_UPLOAD_URL = process.env.STORAGE_SERVER_URL || "";
const INTERNAL_HOST = "http://192.168.0.200:4000";
const PUBLIC_VIEW_ROOT = "https://img.tcroom.kr";
interface ExifrOutput {
  DateTimeOriginal?: Date | string | number;
  SubSecDateTimeOriginal?: Date | string | number;
  CreateDate?: Date | string | number;
  SubSecCreateDate?: Date | string | number;
  ModifyDate?: Date | string | number;
  DateCreated?: Date | string | number; // XMP에서 주로 사용
  DateTime?: Date | string | number;
  CreationDate?: Date | string | number;
  MediaCreateDate?: Date | string | number;
  [key: string]: unknown;
}

type ProcessedImageUpload = {
  url: string;
  thumbnailUrl: string;
  takenAt: Date | null;
};

function parseMetadataDate(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const timestamp = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string") {
    const normalized = value
      .trim()
      .replace(/^(\d{4})[:.](\d{2})[:.](\d{2})/, "$1-$2-$3")
      .replace(" ", "T");
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function parseFilenameDate(filename: string): Date | null {
  const match = filename.match(/(?:^|[_-])(?<date>(?:19|20)\d{6})[_-](?<time>\d{6})(?<millis>\d{1,3})?(?:[_-]|\.|$)/);
  const datePart = match?.groups?.date;
  const timePart = match?.groups?.time;
  if (!datePart || !timePart) return null;

  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(4, 6));
  const day = Number(datePart.slice(6, 8));
  const hour = Number(timePart.slice(0, 2));
  const minute = Number(timePart.slice(2, 4));
  const second = Number(timePart.slice(4, 6));
  const millis = Number((match.groups?.millis || "0").padEnd(3, "0"));

  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    millis > 999
  ) {
    return null;
  }

  const isoString = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}.${String(millis).padStart(3, "0")}+09:00`;
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function uploadImageBuffer(buffer: Buffer, filename: string) {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: "image/webp" });
  formData.append("file", blob, filename);

  const urlObj = new URL(ENV_UPLOAD_URL);
  const { data } = await axios.post(`${INTERNAL_HOST}${urlObj.pathname}`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 60000,
  });

  if (!data.success) return null;
  return `${PUBLIC_VIEW_ROOT}${data.url}`;
}

export async function processAndUploadImage(file: File): Promise<ProcessedImageUpload | null> {
  if (!file || file.size === 0) return null;
  if (!ENV_UPLOAD_URL) return null;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let takenAt: Date | null = null;
    let metadataKeys: string[] = [];

    // --- [Step 1] exifr로 메타데이터 추출 (PNG/XMP 지원) ---
    try {
      // exifr는 buffer를 직접 받아서 파싱합니다.
      // mergeOutput: false로 하면 exif, xmp 등이 분리되지만, true(기본값)면 합쳐져서 찾기 편합니다.
      const metadata = await exifr.parse(buffer, {
        tiff: true,
        ifd0: {},
        exif: true,
        xmp: { parse: true, multiSegment: true },
        icc: false,
        iptc: true,
        jfif: true,
        mergeOutput: true,
        reviveValues: true,
        firstChunkSize: 256 * 1024,
        chunkLimit: 20,
      }) as ExifrOutput | undefined;

      if (metadata) {
        metadataKeys = Object.keys(metadata);

        // 날짜 후보군 (우선순위 순)
        const candidates = [
          metadata.DateTimeOriginal,
          metadata.SubSecDateTimeOriginal,
          metadata.CreateDate,
          metadata.SubSecCreateDate,
          metadata.DateCreated, // XMP에서 날짜 저장하는 필드
          metadata.CreationDate,
          metadata.MediaCreateDate,
          metadata.DateTime,
          metadata.ModifyDate
        ];

        for (const dateRaw of candidates) {
          const parsedDate = parseMetadataDate(dateRaw);
          if (!parsedDate) continue;
          takenAt = parsedDate;
          break;
        }
      } else {
        console.log("⚠️ [EXIF] 메타데이터가 발견되지 않음");
      }
    } catch (e: unknown) {
      console.warn(`⚠️ 메타데이터 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!takenAt) {
      takenAt = parseFilenameDate(file.name || "");
      if (takenAt) {
        console.info(`📸 [EXIF] 촬영일 메타데이터 없음. 파일명 날짜를 사용합니다: ${file.name}`);
      }
    }

    // --- [Step 2] Fallback (파일 수정일) ---
    if (!takenAt) {
      const keySummary = metadataKeys.length > 0 ? ` 감지된 키=${metadataKeys.join(",")}.` : "";
      console.warn(`⚠️ [최종 경고] 촬영일 메타데이터 없음.${keySummary} 파일의 lastModified 사용.`);
      takenAt = new Date(file.lastModified || Date.now());
    }

    // --- [Step 3] 이미지 리사이징 및 업로드 (기존과 동일) ---
    const image = sharp(buffer).rotate();
    const fullBuffer = await image
      .clone()
      .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const thumbnailBuffer = await image
      .clone()
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer();

    const nonce = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const [url, thumbnailUrl] = await Promise.all([
      uploadImageBuffer(fullBuffer, `image-${nonce}.webp`),
      uploadImageBuffer(thumbnailBuffer, `image-${nonce}-thumb.webp`),
    ]);

    if (url) {
      return { url, thumbnailUrl: thumbnailUrl ?? url, takenAt };
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
export async function uploadImages(files: File[]): Promise<ProcessedImageUpload[]> {
  const uploadPromises = files.map(file => processAndUploadImage(file));
  const results = await Promise.all(uploadPromises);

  // 결과가 null이 아닌 것만 필터링하고, 타입스크립트에게 구체적인 객체 형태임을 알려줍니다.
return results.filter((result): result is ProcessedImageUpload => result !== null);
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
