// app/exif-parser.d.ts

declare module 'exif-parser' {
    interface ExifTags {
        DateTimeOriginal?: number; // ???? ??? ?? ?? ?? (Unix Timestamp)
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

    // create ??? ??? ?? ??? ?????.
    export function create(buffer: Buffer): ExifParser;
}
