export type PhotoUploadResponse = {
  success?: boolean;
  postId?: number;
  error?: string;
};

export const MAX_ALBUM_PHOTO_COUNT = 20;
export const MAX_PHOTO_UPLOAD_MB = 20;
export const MAX_PHOTO_UPLOAD_BYTES = MAX_PHOTO_UPLOAD_MB * 1024 * 1024;

export function getPhotoLimitError() {
  return `사진은 1장당 ${MAX_PHOTO_UPLOAD_MB}MB 이하로 올릴 수 있어요.`;
}
