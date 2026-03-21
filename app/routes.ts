import {
  type RouteConfig,
  layout,
  index,
  prefix,
  route
} from "@react-router/dev/routes";

export default [
  // "routes/_layout.tsx" ?뚯씪???꾩껜 ?깆쓽 湲곕낯 ?덉씠?꾩썐?쇰줈 ?ъ슜?⑸땲??
  layout("routes/_layout.tsx", [

    // ???덉씠?꾩썐 ?덉뿉??蹂댁뿬以?泥??섏씠吏濡?"routes/_layout._index.tsx" ?뚯씪??吏?뺥빀?덈떎.
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
    route("ledger/new", "routes/ledger.new.tsx"),
    route("ledger/entries/:entryId/edit", "routes/ledger.entries.$entryId.edit.tsx"),
    route("ledger/:date", "routes/ledger.$date.tsx"),
    route("memory/new", "routes/memory/new.tsx"),
    // 異뷀썑 ???덉씠?꾩썐???ъ슜?섎뒗 ?ㅻⅨ ?섏씠吏媛 ?앷린硫??ш린??異붽??섎㈃ ?⑸땲??
    // ?? route("my-page", "routes/my-page.tsx"),s
    ...prefix("forgot-password", [
      index("routes/forgot-password/index.tsx"),
      route("verify", "routes/forgot-password/verify.tsx"),
      route("reset", "routes/forgot-password/reset.tsx"),
    ]),

  ]),

  ...prefix("space", [
    // ?뱛 routes/space/index.tsx (?꾩껜 ?곗＜ 紐⑸줉/??쒕낫??
    index("routes/space/index.tsx"),

    // ?뱛 routes/space/$spaceId/... (媛쒕퀎 ?곗＜ ?곸꽭)
    ...prefix(":spaceId", [
      index("routes/space/$spaceId/index.tsx"),      // 硫붿씤 ?붾㈃
      route("write", "routes/space/$spaceId/write.tsx"), // 湲?곌린
      route("admin", "routes/space/$spaceId/admin.tsx"), // 愿由ъ옄
      route("mine", "routes/space/$spaceId/mine.tsx"),   // ??湲 紐⑸줉
      route("success", "routes/space/$spaceId/success.tsx"), // ?깃났 ?붾㈃
    ]),
  ]),

  route("admin", "routes/admin/_layout.tsx", [
    index("routes/admin/index.tsx"),

    // ?몙 route(...)瑜?prefix(...)濡?蹂寃쏀빀?덈떎.
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
    route("play", "routes/game/play.tsx"),
    route("host", "routes/game/host.tsx"),
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



