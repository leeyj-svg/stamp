import {
  type RouteConfig,
  layout,
  index,
  prefix,
  route
} from "@react-router/dev/routes";

export default [
  // "routes/_layout.tsx" 파일을 전체 앱의 기본 레이아웃으로 사용합니다.
  layout("routes/_layout.tsx", [

    // 기본 레이아웃 안에서 보여줄 첫 페이지로 "routes/_layout._index.tsx" 파일을 지정합니다.
    index("routes/_layout._index.tsx"),

    route("signup", "routes/signup.tsx"),
    route("login", "routes/login.tsx"),
    route("logout", "routes/logout.ts"),
    route("card", "routes/card/index.tsx"),
    route("events", "routes/events/index.tsx"),
    route("events/:id", "routes/events/$id.tsx"),
    route("albums", "routes/albums/index.tsx"),
    route("albums/upload", "routes/albums/upload.tsx"),
    route("albums/:albumId", "routes/albums/$albumId.tsx"),
    route("community", "routes/community/index.tsx"),
    route("community/new", "routes/community/new.tsx"),
    route("community/:postId", "routes/community/$postId.tsx"),
    route("claim", "routes/claim.tsx"),
    route("mypage", "routes/mypage.tsx"),
    route("ledger", "routes/ledger.tsx"),
    route("ledger/settings", "routes/ledger.settings.tsx"),
    route("ledger/settings/budgets", "routes/ledger.settings.budgets.tsx"),
    route("ledger/settings/categories", "routes/ledger.settings.categories.tsx"),
    route("ledger/budgets", "routes/ledger.budgets.tsx"),
    route("ledger/stats", "routes/ledger.stats.tsx"),
    route("ledger/list", "routes/ledger.list.tsx"),
    route("ledger/weeks", "routes/ledger.weeks.tsx"),
    route("ledger/routine/photos", "routes/ledger.routine-photos.tsx"),
    route("ledger/new", "routes/ledger.new.tsx"),
    route("ledger/entries/:entryId/edit", "routes/ledger.entries.$entryId.edit.tsx"),
    route("ledger/:date", "routes/ledger.$date.tsx"),
    route("devlog", "routes/devlog.tsx"),
    route("devlog/archive", "routes/devlog.archive.tsx"),
    route("devlog/:date", "routes/devlog.$date.tsx"),
    route("devlog/:date/work/:workItemId", "routes/devlogWorkWindow.tsx"),
    route("memory/new", "routes/memory/new.tsx"),
    // 이후 기본 레이아웃을 사용하는 페이지가 생기면 여기에 추가합니다.
    // 예: route("my-page", "routes/my-page.tsx"),
    ...prefix("forgot-password", [
      index("routes/forgot-password/index.tsx"),
      route("verify", "routes/forgot-password/verify.tsx"),
      route("reset", "routes/forgot-password/reset.tsx"),
    ]),

  ]),

  ...prefix("space", [
    // routes/space/index.tsx (전체 우주 목록/대시보드)
    index("routes/space/index.tsx"),

    // routes/space/$spaceId/... (개별 우주 상세)
    ...prefix(":spaceId", [
      index("routes/space/$spaceId/index.tsx"),      // 메인 화면
      route("write", "routes/space/$spaceId/write.tsx"), // 글쓰기
      route("write/photo", "routes/space/$spaceId/write-photo.ts"), // 앨범 사진 JSON 업로드
      route("admin", "routes/space/$spaceId/admin.tsx"), // 관리자
      route("mine", "routes/space/$spaceId/mine.tsx"),   // 내 글 목록
      route("success", "routes/space/$spaceId/success.tsx"), // 성공 화면
    ]),
  ]),

  route("admin", "routes/admin/_layout.tsx", [
    index("routes/admin/index.tsx"),

    // route(...)를 prefix(...)로 묶어 관리합니다.
    ...prefix("events", [
      index("routes/admin/events/index.tsx"),
      route("stats", "routes/admin/events/stats.tsx"),
      route("create", "routes/admin/events/create.tsx"),
      route(":eventId/edit", "routes/admin/events/$eventId/edit.tsx"),
      route(":eventId", "routes/admin/events/$eventId/index.tsx"),

    ]),
    ...prefix("albums", [
      index("routes/admin/albums/index.tsx"),
    ]),
    ...prefix("spaces", [
      index("routes/admin/spaces/index.tsx"),
      route(":spaceId", "routes/admin/spaces/detail.tsx"),
    ]),
    ...prefix("categories", [
      route("managers", "routes/admin/categories/managers.tsx"),
    ]),
    ...prefix("coupons", [
      index("routes/admin/coupons/index.tsx"),

    ]),
    ...prefix("users", [
      index("routes/admin/users/index.tsx"),
      route(":userId", "routes/admin/users/$userId.tsx"),

    ]),
  ]),
  ...prefix("game", [
    index("routes/game/index.tsx"),
    route("telepathy/host", "routes/game/telepathy/host.tsx"),
    route("telepathy/play", "routes/game/telepathy/play.tsx"),
    route("codename/host", "routes/game/codename/host.tsx"),
    route("codename/play", "routes/game/codename/play.tsx"),
    route("codename/key", "routes/game/codename/key.tsx"),
    route("liar/host", "routes/game/liar/host.tsx"),
    route("liar/play", "routes/game/liar/play.tsx"),
    route("scoreboard", "routes/game/scoreboard.tsx"),
    route("scoreboard/control", "routes/game/scoreboard.control.tsx"),
    route("scoreboard/stream", "routes/game/scoreboard.stream.ts"),
    route("word/topics", "routes/game/word/topics.tsx"),
    route("word/host", "routes/game/word/host.tsx"),
    route("word/control", "routes/game/word/control.tsx"),
    route("word/play", "routes/game/word/play.tsx"),
    route("word/stream", "routes/game/word/stream.ts"),
  ]),

  ...prefix("meet", [
    index("routes/meet/index.tsx"),
    ...prefix(":id", [
      index("routes/meet/$id/index.tsx"),
    ]),
  ]),

  route("api/categories", "routes/api/categories.ts"),
  route("api/users/search", "routes/api/users/search.ts"),
  route("api/users/check", "routes/api/users/check.ts"),
  route("api/events/search", "routes/api/events/event-search.ts"),
  route("api/events/delete", "routes/api/events/delete.ts"),
  route("api/events/reviews", "routes/api/events/reviews.ts"),
  route("api/events/:id", "routes/api/events/$id.ts"),
  route("api/events/:id/like", "routes/api/events/$id.like.ts"),
  route("api/community/:postId/like", "routes/api/community/$postId.like.ts"),
  route("api/stamps/view", "routes/api/stamps/view.ts"),
  route("api/coupons/issue", "routes/api/coupons/issue.ts"),
] satisfies RouteConfig;



