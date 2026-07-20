// app/exif-parser.d.ts

declare module 'exif-parser' {
    interface ExifTags {
        DateTimeOriginal?: number; // 사진 촬영 시각 태그 (Unix Timestamp)
        [key: string]: unknown;
    }

    interface ExifResult {
        tags: ExifTags;
        imageSize: { width: number; height: number };
        thumbnailOffset?: number;
        thumbnailLength?: number;
        thumbnailType?: number;
        app1Offset?: number;
    }

    interface ExifParser {
        parse(): ExifResult;
    }

    // create 함수 타입을 직접 선언합니다.
    export function create(buffer: Buffer): ExifParser;
}
