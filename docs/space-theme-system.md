# SPACE Theme System

## Current Interaction Rule

- The SPACE owner (`MemorySpace.userId`) and admins are the only users who can move note objects.
- Guest writers and other viewers can read the SPACE, but they cannot change object positions.
- Dragged note positions are saved to `MemoryPostAppearance.style` for the relevant `viewport + MEMORY` surface.
- Opened note cards use the same saved position as their theme object; owners/admins can drag the opened note card itself to move the note and object together.
- PC and mobile positions are stored separately, so each viewport can keep its own optimized layout.
- Position updates are server-validated against ownership/admin permission and clamped before saving.

## Album Rendering Rule

- Desktop and mobile album renderers are separate because each viewport has a different layout target.
- Album cards must change structure by theme, not only color.
- Shared helpers such as album image frames and theme motifs should stay in `SpaceExperience.tsx` unless they grow large enough to move into a dedicated component.
- The current desktop album patterns are constellation board, camp photo line, petal postcard wall, sea gallery, autumn scrapbook, frosted gallery, film contact sheet, and party wall.

## Entrance Effect Rule

- The public recipient SPACE route (`/space/:spaceId`) plays a short theme entrance effect whenever the unlocked SPACE screen opens.
- The writer-only preview route (`/space/:spaceId/mine`) does not play the entrance effect.
- Memory note objects stay hidden at the start of the entrance effect, then reveal while the theme particles burst outward.
- Desktop and mobile use separate particle offsets through CSS media queries while sharing the same theme object shapes.
- Users with reduced-motion preferences should not receive the entrance burst or note reveal animation.

## Album Performance Rule

- SPACE should not load every album photo at once.
- The initial unlocked SPACE payload includes all memory notes and only the first album page.
- Additional album photos load through the same route with `intent=album_page`.
- Album pagination uses `MemoryPostAppearance.sortOrder` for the desktop album surface so theme placement order stays stable.
- Photo cards should use `thumbnailUrl` first and fall back to `mediaUrl`.
- The photo preview modal should use `mediaUrl` first and fall back to `thumbnailUrl`.
- New uploads create two webp files: a larger view image and a smaller card thumbnail.
- Album uploads from the write page are sent as a sequential client queue: one request per photo with `intent=upload_album_photo`.
- The queue avoids bundling many photos into one multipart request, so proxy request-size limits apply per photo request rather than to the full selected set.
- The write page allows up to 20 album photos per submission, and each original photo must be 20MB or smaller.
- Friends can add album photos by drag-and-drop or by selecting multiple files at once; storage still happens through the one-photo-at-a-time queue.
- If one queued photo fails, the remaining photos should continue uploading. Failed photos stay in the list and can be retried.
- Queued album photos post to `/space/:spaceId/write/photo`, a JSON-only resource route, so the client never has to parse an HTML document as an upload result.

## Friend Writing Flow

- Friends open `/space/:spaceId/write`.
- The write route is intentionally available to guests. Login is optional.
- The friend enters a nickname and chooses either message or album.
- Message posts save text only.
- Album posts process one image per queued request, extract a best-effort taken date from metadata, create a large image and thumbnail, upload both, then save one `MemoryPost` per photo.
- Photo taken dates are read from EXIF/XMP/IPTC fields when possible. If the uploaded file has no readable capture date, the server next tries filename timestamps such as `KakaoTalk_YYYYMMDD_HHMMSS...`, then falls back to `File.lastModified`.
- Album photo count and file-size limits must be enforced on both the client and server.
- After each post is created, `MemoryPostAppearance` rows are created for desktop/mobile and memory/album as needed.
- The writer receives a signed `my-posts` cookie containing their post ids so they can find/delete their own guest posts later.
- Theme changes never delete or duplicate friend content; they only regenerate appearance rows.

## Public Date Rule

- `MemorySpace.targetDate` represents the Korean calendar day when the recipient SPACE opens.
- Public SPACE access should open at 00:00 Asia/Seoul on that calendar day.
- Date-only form values must be parsed as `YYYY-MM-DDT00:00:00+09:00`, not as JavaScript's UTC `new Date("YYYY-MM-DD")` behavior.
- Existing spaces may contain UTC-midnight date-only values; unlocked checks compare Korean date keys so those spaces still open on the intended Korean date.

## 기본 규칙

- `MemorySpace.themeKey`는 공간의 단일 테마입니다.
- PC와 모바일은 같은 테마를 공유하지만 `MemorySpaceAppearance`와 `MemoryPostAppearance`로 레이아웃은 따로 저장합니다.
- 메모와 앨범은 별도 화면입니다. `MEMORY`는 쪽지, `ALBUM`은 사진에 최적화합니다.
- 비회원 작성은 열어둡니다. 작성 권한을 로그인으로 막지 않습니다.
- 테마 변경은 `ADMIN` 또는 공간에 연결된 주인공(`MemorySpace.userId`)만 할 수 있습니다.
- 테마 변경은 기존 글/사진을 삭제하거나 복제하지 않고 appearance만 다시 생성합니다.

## 저장 구조

- `MemorySpace.themeKey`: 현재 선택한 테마 키입니다.
- `MemorySpaceAppearance`: 공간 단위 레이아웃입니다.
  - `DESKTOP + MEMORY`
  - `DESKTOP + ALBUM`
  - `MOBILE + MEMORY`
  - `MOBILE + ALBUM`
- `MemoryPostAppearance`: 글/사진 단위 위치와 스타일입니다.
  - 쪽지는 `MEMORY` surface에 PC/모바일 2개 appearance를 가집니다.
  - 사진은 `ALBUM` surface에 PC/모바일 2개 appearance를 가집니다.

## 공통 함수 위치

- `app/lib/space-theme.ts`: 클라이언트와 서버가 같이 쓰는 테마 목록, 타입, 순수 배치 함수입니다.
- `app/lib/space-theme.server.ts`: DB에 appearance를 생성하거나 재생성하는 서버 전용 함수입니다.

## 보안 기준

- `/space/:spaceId/write`는 게스트 작성이 가능해야 합니다.
- `/memory/new`, `/space/:spaceId/admin`은 관리자 권한을 요구합니다.
- 공개 화면의 테마 변경 action은 로그인 사용자가 `ADMIN`이거나 연결 주인공일 때만 허용합니다.
- 업로드 작성 action은 항상 실제 space 존재 여부를 확인한 뒤 저장합니다.
