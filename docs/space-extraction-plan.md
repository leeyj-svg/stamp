# SPACE 전용 앱 추출 설계서

이 문서는 현재 `stamp` 앱 안에 있는 SPACE 기능만 분리해서 새 앱으로 만들기 위한 기준 문서입니다.
새 채팅이나 새 작업 폴더로 이동하더라도 이 문서를 기준으로 이어서 작업할 수 있게 작성합니다.

## 목표

SPACE를 스탬프, 이벤트, 가계부, 커뮤니티 기능에서 분리해서 독립 서비스로 만든다.

새 앱은 다음 흐름만 집중한다.

- 관리자가 SPACE를 만든다.
- 친구들은 로그인 없이 작성 링크에서 쪽지와 사진을 남긴다.
- 주인공은 공개일 이후 비밀번호로 입장해 쪽지와 앨범을 본다.
- 관리자와 주인공은 테마를 변경할 수 있다.
- PC와 모바일은 같은 테마를 쓰되 배치는 따로 저장한다.

## 새 앱 위치

권장 새 폴더:

```text
C:\tcroom-space
```

또는 repo 이름:

```text
tcroom-space
```

현재 repo는 참고 원본으로 유지하고, 새 앱에는 SPACE 관련 코드만 선별해서 가져간다.

## 가져갈 핵심 파일

현재 repo에서 우선 가져갈 파일:

```text
app/routes/space/**
app/routes/admin/spaces/**
app/components/space/**
app/lib/space-theme.ts
app/lib/space-theme.server.ts
app/lib/space-scene.ts
app/lib/space-upload.ts
app/lib/space-meta.ts
app/lib/upload.server.ts
docs/space-theme-system.md
public/logo.png
```

필요하면 일부 가져갈 파일:

```text
app/lib/auth.server.ts
app/lib/cookies.server.ts
app/lib/db.server.ts
app/lib/session.server.ts
app/components/ui/**
app/routes/memory/new.tsx
```

가져가지 않을 기능:

```text
ledger
devlog
stamp card
events
albums 일반 기능
community
game
coupon
alimtalk
```

## 새 앱 권장 기술 구조

현재 코드와 최대한 호환되게 시작한다.

```text
React Router
TypeScript
Prisma
MySQL
Tailwind CSS
lucide-react
sharp
exifr 또는 현재 EXIF 파서
S3/R2 또는 현재 이미지 업로드 서버
```

새 앱 디렉터리 구조 예시:

```text
app/
  components/
    space/
    ui/
  features/
    space/
      space-theme.ts
      space-theme.server.ts
      space-scene.ts
      space-upload.ts
      space-meta.ts
  lib/
    auth.server.ts
    db.server.ts
    storage.server.ts
    cookies.server.ts
  routes/
    _index.tsx
    space/
      $spaceId/
        index.tsx
        write.tsx
        write-photo.ts
        mine.tsx
        success.tsx
    admin/
      spaces/
        index.tsx
        new.tsx
        $spaceId.tsx
prisma/
  schema.prisma
public/
  logo.png
```

## 라우트 설계

공개 라우트:

```text
/space/:spaceId
/space/:spaceId/write
/space/:spaceId/write/photo
/space/:spaceId/mine
/space/:spaceId/success
```

관리자 라우트:

```text
/admin/spaces
/admin/spaces/new
/admin/spaces/:spaceId
```

선택적으로 짧은 공유 URL을 추가할 수 있다.

```text
/s/:spaceId
/s/:spaceId/write
```

단, 초기 분리 단계에서는 기존 `/space/:spaceId`를 유지하는 것을 권장한다.

## DB 이름 정리

현재 이름:

```text
MemorySpace
MemoryPost
MemorySpaceAppearance
MemoryPostAppearance
```

새 앱 권장 이름:

```text
Space
SpacePost
SpaceAppearance
SpacePostAppearance
```

SPACE 전용 앱에서는 `Memory` 접두어가 필요 없다.

## Prisma 모델 초안

```prisma
enum UserRole {
  ADMIN
  USER
}

enum SpacePostType {
  MESSAGE
  ALBUM
}

enum SpaceViewport {
  DESKTOP
  MOBILE
}

enum SpaceSurface {
  MEMORY
  ALBUM
}

model User {
  id          String    @id @default(cuid())
  name        String
  phoneNumber String?   @unique
  role        UserRole  @default(USER)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  spaces      Space[]
  posts       SpacePost[]
}

model Space {
  id             String   @id @default(uuid())
  title          String
  targetDate     DateTime
  passwordHash   String
  themeKey       String   @default("galaxy")
  ownerUserId    String?
  recipientName  String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  owner       User?             @relation(fields: [ownerUserId], references: [id])
  posts       SpacePost[]
  appearances SpaceAppearance[]

  @@index([targetDate])
  @@index([ownerUserId])
}

model SpacePost {
  id           Int           @id @default(autoincrement())
  spaceId      String
  type         SpacePostType
  content      String?       @db.Text
  mediaUrl     String?
  thumbnailUrl String?
  nickname     String
  writerId     String?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  deletedAt    DateTime?

  space       Space                 @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  writer      User?                 @relation(fields: [writerId], references: [id])
  appearances SpacePostAppearance[]

  @@index([spaceId, type, createdAt])
  @@index([writerId])
}

model SpaceAppearance {
  id        Int           @id @default(autoincrement())
  spaceId   String
  viewport  SpaceViewport
  surface   SpaceSurface
  layoutKey String
  config    Json?
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt

  space Space @relation(fields: [spaceId], references: [id], onDelete: Cascade)

  @@unique([spaceId, viewport, surface])
  @@index([spaceId, viewport])
}

model SpacePostAppearance {
  id        Int           @id @default(autoincrement())
  postId    Int
  viewport  SpaceViewport
  surface   SpaceSurface
  style     Json?
  sortOrder Int           @default(0)
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt

  post SpacePost @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@unique([postId, viewport, surface])
  @@index([viewport, surface, sortOrder])
}
```

## 인증과 권한

권한은 다음처럼 나눈다.

관리자:

- SPACE 생성, 수정, 삭제
- 작성 링크와 주인공 링크 복사
- 모든 글 관리
- 테마 변경
- PC/모바일 위치 저장

주인공:

- 공개일 이후 비밀번호로 입장
- 본인 SPACE 테마 변경 가능
- 배치 저장 가능 여부는 정책으로 선택한다. 현재 설계는 주인공도 테마 변경 가능, 위치 저장은 관리자 중심으로 둔다.

친구 작성자:

- 로그인 없이 쪽지 작성 가능
- 로그인 없이 사진 작성 가능
- 본인이 작성한 글만 `/mine`에서 볼 수 있음
- 본인이 작성한 글만 삭제 가능
- 다른 사람 글 이동, 테마 변경, 전체 열람은 불가

게스트 작성자를 막으면 안 된다.
보안은 차단보다 제한과 검증 중심으로 설계한다.

## 비회원 작성자 식별

현재 방식:

- 작성 성공 시 signed cookie에 post id 저장
- `/mine`에서 cookie에 있는 post id만 조회

새 앱에서도 이 방식으로 시작 가능하다.

개선안:

- `space_my_posts` signed cookie 유지
- post id만 저장
- 쿠키는 HttpOnly, SameSite=Lax
- 쿠키 크기 제한을 고려해 최대 100개 정도만 유지

## 업로드 규칙

현재 결정된 규칙:

- 사진 최대 20장
- 한 장당 20MB 이하
- 한 번에 한 장씩 큐 업로드
- 한 장 실패해도 전체가 실패하지 않아야 함
- 업로드 응답은 항상 JSON
- HTML 에러페이지를 JSON으로 파싱하는 상황을 만들지 않음

서버 처리:

- 이미지 MIME 타입 검증
- 파일 크기 검증
- sharp로 리사이징
- thumbnail 생성
- EXIF 날짜가 있으면 `createdAt`에 반영
- EXIF가 없으면 `lastModified` 또는 서버 업로드 시각 사용

Cloudflare나 프록시 100MB 제한을 피하기 위해 큐 업로드를 유지한다.

## 텍스트 제한

현재 정책:

```text
닉네임: 80자
쪽지 본문: 3000자
사진 설명: 1000자
```

DB 컬럼:

```text
SpacePost.content: TEXT
```

저장 실패 시 라우터 에러페이지가 아니라 작성 화면의 경고로 보여준다.

## 테마 정책

기본 테마:

```text
galaxy
```

현재 테마 목록:

```text
galaxy
camping_night
spring_petals
summer_sea
autumn_leaves
winter_snow
film_polaroid
birthday_party
```

규칙:

- 하나의 SPACE는 하나의 `themeKey`를 가진다.
- PC와 모바일은 같은 테마를 공유한다.
- PC와 모바일의 배치 데이터는 따로 저장한다.
- 쪽지와 앨범도 surface를 나누어 따로 최적화한다.
- 테마 변경 시 PC/모바일, 쪽지/앨범 appearance를 함께 재생성한다.
- 자동 테마 변경은 하지 않는다.
- 추천 기능은 필요하면 나중에 추가하되, 사용자의 선택을 자동으로 덮어쓰지 않는다.

## PC와 모바일 배치

반응형 하나로 처리하지 않는다.

저장 단위:

```text
SpaceAppearance: space + viewport + surface
SpacePostAppearance: post + viewport + surface
```

뷰포트:

```text
DESKTOP
MOBILE
```

서피스:

```text
MEMORY
ALBUM
```

PC:

- 넓은 캔버스
- 여러 쪽지 모달 동시 열기
- 오브젝트 위치 저장 가능

모바일:

- 첫 화면은 테마 오브젝트 장면
- 가로 스크롤 장면 보기 가능
- 여러 개 보기와 한 번에 보기 제공
- 모달이 화면 밖으로 나가지 않도록 clamp
- 작성자명은 과하게 노출하지 않음

## 앨범 정책

앨범도 테마에 맞게 다르게 보인다.

공통:

- 색만 바꾸는 수준은 피한다.
- 테마별로 프레임, 배치, 장식, 여백, 모션 느낌을 다르게 둔다.
- 사진이 많을 수 있으므로 페이지네이션 또는 cursor pagination을 유지한다.

현재 정책:

- 최초 공개 화면은 쪽지 전체와 앨범 첫 페이지를 로드
- 앨범은 `ALBUM_PAGE_SIZE = 24`
- 더 보기로 추가 로드

## 카카오 미리보기

기본 링크:

```text
/
```

제목:

```text
아이들과 교사들의 행복한 공간 tcroom
```

설명:

```text
없음
```

작성자 링크:

```text
/space/:spaceId/write
```

제목:

```text
소중한 마음이 담긴 쪽지와 사진을 남겨주세요!
```

설명:

```text
전하고 싶은 마음을 쪽지와 사진으로 남기면 공개일까지 비공개로 안전하게 보관돼요.
```

주인공 링크:

```text
/space/:spaceId
```

제목:

```text
소중한 마음들이 도착했어요
```

설명:

```text
친구들이 남긴 쪽지와 사진을 테마 공간에서 천천히 확인해보세요.
```

이미지:

```text
/logo.png
```

주의:

- `APP_URL`은 반드시 프로토콜을 포함한다.
- 올바른 예: `https://www.tcroom.kr`
- 잘못된 예: `www.tcroom.kr`
- 카카오는 캐시가 강하므로 배포 후 공유 디버거에서 캐시 초기화가 필요할 수 있다.

## 환경 변수

필수:

```text
APP_URL=https://www.tcroom.kr
DATABASE_URL=
COOKIE_SECRET=
STORAGE_SERVER_URL=
```

선택:

```text
GEMINI_API_KEY=
IMMICH_URL=
IMMICH_API_KEY=
IMMICH_DEVICE_ID=
```

SPACE 전용 앱 초기 버전에서는 Gemini와 Immich는 필수가 아니다.

## 보안 기준

비회원 작성은 허용하되 다음은 지킨다.

- 파일 용량 제한
- 이미지 MIME 타입 검증
- 이미지 리사이징
- 업로드 응답 JSON 고정
- 긴 본문은 TEXT 저장
- 공개일 전 전체 글 열람 차단
- 작성자 본인 글은 signed cookie 기준으로만 접근
- 관리자 라우트는 로그인 및 role 검사
- 주인공 비밀번호는 평문 저장하지 않고 hash 저장
- brute force 방지를 위해 비밀번호 입력은 rate limit 또는 지연 적용
- 과한 차단보다 안전한 제한과 명확한 경고를 우선한다.

## 데이터 이전 전략

기존 데이터를 새 앱으로 가져와야 하면 스크립트를 만든다.

매핑:

```text
MemorySpace -> Space
MemoryPost -> SpacePost
MemorySpaceAppearance -> SpaceAppearance
MemoryPostAppearance -> SpacePostAppearance
```

주의:

- 기존 `password`가 평문이면 새 앱 이전 시 hash로 변환한다.
- 기존 `type` 값 중 `PHOTO`는 `ALBUM`으로 정규화한다.
- 기존 `content`는 TEXT로 유지한다.
- 기존 `mediaUrl`, `thumbnailUrl`은 그대로 사용한다.
- 기존 `themeKey`가 없으면 `galaxy`로 채운다.

## 구현 순서

1. 새 React Router 앱 생성
2. Tailwind, Prisma, 기본 UI 세팅
3. Prisma schema를 SPACE 전용으로 작성
4. `User`, `Space`, `SpacePost`, appearance 모델 migration
5. auth와 cookie 최소 구현
6. theme, scene, upload, meta lib 이식
7. `components/space` 이식
8. 공개 라우트 이식
9. 관리자 라우트 이식
10. 업로드 큐 검증
11. 카카오 OG 메타 검증
12. PC/모바일 레이아웃 검증
13. 기존 데이터 이전 여부 결정
14. 배포

## 새 채팅 시작 프롬프트

새 앱 작업을 다른 채팅에서 시작해야 하면 아래처럼 말한다.

```text
C:\stamp\docs\space-extraction-plan.md 문서를 기준으로 SPACE 전용 앱을 만들어줘.
현재 원본 코드는 C:\stamp에 있고, 새 앱은 C:\tcroom-space에 만들고 싶어.
기존 SPACE 기능은 유지하되 앱 이름과 DB 모델은 SPACE 전용으로 정리해줘.
```

## 현재 남은 결정 사항

- 새 앱 도메인: `www.tcroom.kr` 유지 또는 `space.tcroom.kr` 분리
- 이미지 저장소: 기존 `img.tcroom.kr` 유지 또는 새 버킷 분리
- 주인공 계정 로그인 방식: 기존 회원 연결 유지 또는 비밀번호 입장만 유지
- 관리자 계정 정책: 단일 관리자 또는 다중 관리자
- 데이터 이전 필요 여부

