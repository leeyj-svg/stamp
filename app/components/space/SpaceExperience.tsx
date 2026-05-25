import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Form, useFetcher } from "react-router";
import { ImageIcon, LockKeyhole, MessageCircle, Palette, Settings, X } from "lucide-react";

import { SceneShapeView } from "~/components/space/SceneShape";
import {
  getAmbientSceneObjects,
  getSceneObjectDescriptor,
  sceneRandomRange,
  type SceneObjectDescriptor,
  type SceneShape,
} from "~/lib/space-scene";
import {
  SPACE_THEME_OPTIONS,
  getPostAppearance,
  getPostSortOrder,
  getSpaceTheme,
  parseDesktopAlbumStyle,
  parseDesktopMemoryStyle,
  parseMobileCardStyle,
  type DesktopMemoryStyle,
  type MobileCardStyle,
  type SpaceAlbumPage,
  type SpacePostForTheme,
} from "~/lib/space-theme";

type SpaceSummary = {
  id: string;
  title: string;
  targetDate: Date | string;
  themeKey: string;
};

type SurfaceView = "MEMORY" | "ALBUM";

type SpaceExperienceProps = {
  space: SpaceSummary;
  posts: SpacePostForTheme[];
  initialAlbumPage?: SpaceAlbumPage | null;
  initialView?: SurfaceView;
  canChangeTheme?: boolean;
  showSettingsMenu?: boolean;
  allowPreviewDrag?: boolean;
};

type AlbumPageResponse = {
  albumPage?: SpaceAlbumPage;
  error?: string;
};

type AlbumPaginationProps = {
  albumPosts: SpacePostForTheme[];
  albumHasMore: boolean;
  albumLoading: boolean;
  onLoadMoreAlbum: () => void;
};

type LockedSpaceProps = {
  space: SpaceSummary;
  isDatePassed: boolean;
  targetDate: Date | string;
  error?: string | null;
};

type MobileReadMode = "SCENE" | "LIST";
type ScenePosition = { x: number; y: number };
type ScenePositionMap = Record<number, ScenePosition>;
type SceneDragBounds = { minX: number; maxX: number; minY: number; maxY: number };

const DESKTOP_DRAG_BOUNDS: SceneDragBounds = { minX: -560, maxX: 560, minY: -300, maxY: 300 };
const MOBILE_DRAG_BOUNDS: SceneDragBounds = { minX: -330, maxX: 330, minY: -190, maxY: 170 };

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampPosition(position: ScenePosition, bounds: SceneDragBounds): ScenePosition {
  return {
    x: Math.round(clampNumber(position.x, bounds.minX, bounds.maxX)),
    y: Math.round(clampNumber(position.y, bounds.minY, bounds.maxY)),
  };
}

function useSceneObjectDrag({
  position,
  bounds,
  onMove,
  onCommit,
}: {
  position: ScenePosition;
  bounds: SceneDragBounds;
  onMove?: (position: ScenePosition) => void;
  onCommit?: (position: ScenePosition) => void;
}) {
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPosition: ScenePosition;
    lastPosition: ScenePosition;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!onMove || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: position,
      lastPosition: position,
      moved: false,
    };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !onMove) return;

    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    if (!drag.moved && Math.abs(deltaX) + Math.abs(deltaY) < 5) return;

    drag.moved = true;
    event.preventDefault();
    const nextPosition = clampPosition(
      {
        x: drag.startPosition.x + deltaX,
        y: drag.startPosition.y + deltaY,
      },
      bounds
    );
    drag.lastPosition = nextPosition;
    onMove(nextPosition);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.moved) {
      onCommit?.(drag.lastPosition);
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const consumeClickSuppression = () => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  };

  return {
    consumeClickSuppression,
    dragHandlers: {
      onPointerDown: startDrag,
      onPointerMove: moveDrag,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
    },
  };
}

function isAlbumPost(post: SpacePostForTheme) {
  return post.type === "ALBUM" || post.type === "PHOTO";
}

function getStoredStyleNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record[key] === "number" ? record[key] : null;
}

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getThemeObjectLabel(themeKey: string) {
  const theme = getSpaceTheme(themeKey);

  switch (theme.key) {
    case "camping_night":
      return "불빛";
    case "spring_petals":
      return "꽃잎";
    case "summer_sea":
      return "물결";
    case "autumn_leaves":
      return "낙엽";
    case "winter_snow":
      return "눈송이";
    case "film_polaroid":
      return "필름";
    case "birthday_party":
      return "축하 조각";
    case "galaxy":
    default:
      return "별";
  }
}

function toggleOpenId(ids: number[], postId: number) {
  if (ids.includes(postId)) {
    return [...ids.filter((id) => id !== postId), postId];
  }
  return [...ids, postId];
}

function getDesktopObjectStyle(post: SpacePostForTheme, index: number): DesktopMemoryStyle {
  const appearance = getPostAppearance(post, "DESKTOP", "MEMORY");
  const style = parseDesktopMemoryStyle(appearance?.style, index);
  return {
    ...style,
    x: clampNumber(style.x, -520, 520),
    y: clampNumber(style.y, -260, 260),
  };
}

function getDesktopNotePosition(style: DesktopMemoryStyle) {
  const opensLeft = style.x > 210;
  const opensUp = style.y > 120;
  return {
    x: clampNumber(style.x + (opensLeft ? -370 : 92), -560, 500),
    y: clampNumber(style.y + (opensUp ? -230 : -42), -300, 250),
  };
}

function getMobileObjectStyle(post: SpacePostForTheme, index: number, themeKey: string): MobileCardStyle & { x: number; y: number } {
  const appearance = getPostAppearance(post, "MOBILE", "MEMORY");
  const style = parseMobileCardStyle(appearance?.style, index);
  const angle = index * 2.399963 + sceneRandomRange(`${themeKey}:mobile:${post.id}:angle`, -0.52, 0.52);
  const radius = 88 + (index % 7) * 34 + sceneRandomRange(`${themeKey}:mobile:${post.id}:radius`, -18, 24);
  const storedX = getStoredStyleNumber(appearance?.style, "x");
  const storedY = getStoredStyleNumber(appearance?.style, "y");
  return {
    ...style,
    x: Math.round(clampNumber(storedX ?? Math.cos(angle) * radius + style.lane * 34 + style.offsetX, -260, 260)),
    y: Math.round(clampNumber(storedY ?? Math.sin(angle) * radius * 0.56 + style.offsetY, -164, 144)),
  };
}

function getMobileNotePosition(style: MobileCardStyle & { x: number; y: number }) {
  return {
    x: clampNumber(style.x - 160, -340, 42),
    y: clampNumber(style.y + (style.y > -64 ? -226 : 62), -190, -48),
  };
}

function getDesktopNoteCardColor(themeKey: string, postId: number, index: number) {
  const palettes: Record<string, string[]> = {
    galaxy: ["rgba(20, 24, 58, 0.94)", "rgba(36, 31, 82, 0.94)", "rgba(24, 46, 72, 0.94)", "rgba(47, 30, 68, 0.94)"],
    camping_night: ["rgba(54, 34, 20, 0.94)", "rgba(64, 40, 24, 0.94)", "rgba(48, 36, 26, 0.94)", "rgba(72, 42, 22, 0.94)"],
    spring_petals: ["rgba(255, 241, 242, 0.96)", "rgba(255, 228, 230, 0.96)", "rgba(252, 231, 243, 0.96)", "rgba(255, 247, 237, 0.96)"],
    summer_sea: ["rgba(236, 254, 255, 0.96)", "rgba(224, 242, 254, 0.96)", "rgba(207, 250, 254, 0.96)", "rgba(240, 253, 250, 0.96)"],
    autumn_leaves: ["rgba(255, 247, 237, 0.96)", "rgba(254, 243, 199, 0.96)", "rgba(255, 237, 213, 0.96)", "rgba(254, 226, 226, 0.96)"],
    winter_snow: ["rgba(239, 246, 255, 0.96)", "rgba(224, 242, 254, 0.96)", "rgba(241, 245, 249, 0.96)", "rgba(219, 234, 254, 0.96)"],
    film_polaroid: ["rgba(250, 250, 249, 0.97)", "rgba(245, 245, 244, 0.97)", "rgba(254, 243, 199, 0.97)", "rgba(255, 251, 235, 0.97)"],
    birthday_party: ["rgba(255, 241, 242, 0.96)", "rgba(252, 231, 243, 0.96)", "rgba(254, 249, 195, 0.96)", "rgba(237, 233, 254, 0.96)"],
  };
  const palette = palettes[themeKey] ?? palettes.galaxy;
  return palette[(postId + index) % palette.length] ?? palette[0];
}

function getNoteDescriptor(themeKey: string, viewport: "desktop" | "mobile", postId: number, index: number) {
  return getSceneObjectDescriptor({
    themeKey,
    seed: `${themeKey}:${viewport}:post:${postId}:${index}`,
    interactive: true,
  });
}

export function SpaceThemeBackground({ themeKey }: { themeKey: string }) {
  const theme = getSpaceTheme(themeKey);

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0" style={{ background: theme.background.base }} />
      <div className="absolute inset-0" style={{ background: theme.background.overlay }} />
      <ThemeDecorationLayer themeKey={themeKey} />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/32 to-transparent" />
    </div>
  );
}

const AMBIENT_DEPTH_STYLES = [
  { opacity: 0.92, scale: 0.96, size: 1, blur: 0.7, glow: 9, saturate: 0.9, brightness: 1, blend: "screen" },
  { opacity: 0.74, scale: 0.82, size: 0.92, blur: 1.3, glow: 7, saturate: 0.82, brightness: 0.95, blend: "soft-light" },
  { opacity: 0.58, scale: 0.68, size: 0.78, blur: 2.1, glow: 5, saturate: 0.72, brightness: 0.9, blend: "screen" },
  { opacity: 0.4, scale: 1.28, size: 1.36, blur: 4.4, glow: 12, saturate: 0.62, brightness: 0.86, blend: "soft-light" },
] as const;

function getAmbientDepthStyle(index: number) {
  return AMBIENT_DEPTH_STYLES[index % AMBIENT_DEPTH_STYLES.length] ?? AMBIENT_DEPTH_STYLES[0];
}

function ThemeDecorationLayer({ themeKey }: { themeKey: string }) {
  const ambientObjects = useMemo(() => getAmbientSceneObjects(themeKey, 58), [themeKey]);

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {ambientObjects.map((object, index) => {
        const depthStyle = getAmbientDepthStyle(index);
        const size = Math.round(object.size * depthStyle.size);
        return (
          <div
            key={object.id}
            className="pointer-events-none absolute"
            style={{
              top: `${object.top}%`,
              left: `${object.left}%`,
              width: `${size}px`,
              height: `${size}px`,
              opacity: object.opacity * depthStyle.opacity,
              transform: `rotate(${object.rotation}deg) scale(${object.scale * depthStyle.scale})`,
              color: object.color,
              filter: `blur(${object.blur + depthStyle.blur}px) saturate(${depthStyle.saturate}) brightness(${depthStyle.brightness}) drop-shadow(0 0 ${depthStyle.glow}px ${object.glowColor})`,
              mixBlendMode: depthStyle.blend,
            }}
          >
            <AnimatedSceneShape descriptor={object} />
          </div>
        );
      })}
    </div>
  );
}

function AnimatedSceneShape({ descriptor }: { descriptor: SceneObjectDescriptor }) {
  return (
    <div
      className={`space-scene-motion space-scene-${descriptor.motion} h-full w-full`}
      style={{
        animationDuration: `${descriptor.duration}s`,
        animationDelay: `${descriptor.delay}s`,
      }}
    >
      <SceneShapeView shape={descriptor.shape} descriptor={descriptor} />
    </div>
  );
}

export function SpaceThemePicker({ currentThemeKey, compact = false }: { currentThemeKey: string; compact?: boolean }) {
  const currentTheme = getSpaceTheme(currentThemeKey);

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4" style={{ color: currentTheme.accentColor }} />
        <div>
          <p className="text-sm font-bold text-slate-900">테마</p>
          <p className="text-xs text-slate-500">PC와 모바일이 함께 변경됩니다.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SPACE_THEME_OPTIONS.map((theme) => {
          const selected = theme.key === currentTheme.key;
          return (
            <Form key={theme.key} method="post">
              <input type="hidden" name="intent" value="change_theme" />
              <input type="hidden" name="themeKey" value={theme.key} />
              <button
                type="submit"
                aria-pressed={selected}
                className={`h-full w-full rounded-lg border p-3 text-left transition ${
                  selected ? "border-slate-900 bg-slate-900 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                }`}
              >
                <span className="block text-xs font-bold">{theme.label}</span>
                <span className={selected ? "mt-1 block text-[11px] text-white/70" : "mt-1 block text-[11px] text-slate-400"}>{theme.shortLabel}</span>
              </button>
            </Form>
          );
        })}
      </div>
    </div>
  );
}

export function LockedSpaceScreen({ space, isDatePassed, targetDate, error }: LockedSpaceProps) {
  const theme = getSpaceTheme(space.themeKey);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-10 text-center" style={{ color: theme.textColor }}>
      <SpaceThemeBackground themeKey={space.themeKey} />
      <section className="relative z-10 w-full max-w-sm rounded-lg border border-white/15 p-6 shadow-2xl backdrop-blur-md" style={{ backgroundColor: theme.panelColor }}>
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-white/10">
          <LockKeyhole className="h-5 w-5" />
        </div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.24em]" style={{ color: theme.mutedTextColor }}>
          {space.title}
        </p>
        <h1 className="text-2xl font-bold leading-tight">{isDatePassed ? "비밀번호를 입력해 주세요" : theme.lockedTitle}</h1>
        <p className="mt-4 text-sm leading-relaxed" style={{ color: theme.mutedTextColor }}>
          {isDatePassed ? "초대받은 분이라면 비밀번호로 공간을 열 수 있어요." : `${formatDate(targetDate)}에 공개됩니다.`}
        </p>

        {isDatePassed ? (
          <Form method="post" className="mt-6 space-y-3">
            <input
              type="password"
              name="password"
              placeholder="비밀번호"
              className="w-full rounded-lg border border-white/15 bg-black/24 px-4 py-3 text-center text-sm font-bold tracking-widest text-white outline-none placeholder:text-white/35 focus:border-white/50"
              required
            />
            {error && <p className="rounded bg-red-500/15 px-3 py-2 text-xs font-bold text-red-100">{error}</p>}
            <button className="w-full rounded-lg px-4 py-3 text-sm font-bold text-slate-950 shadow-lg transition hover:brightness-105" style={{ backgroundColor: theme.accentColor }}>
              열기
            </button>
          </Form>
        ) : (
          <div className="mt-6 rounded-lg border border-white/10 bg-white/10 px-4 py-3 text-sm" style={{ color: theme.mutedTextColor }}>
            지금은 비공개로 안전하게 보관 중이에요.
          </div>
        )}
      </section>
    </main>
  );
}

export function SpaceExperience({
  space,
  posts,
  initialAlbumPage = null,
  initialView = "MEMORY",
  canChangeTheme = false,
  showSettingsMenu = true,
  allowPreviewDrag = false,
}: SpaceExperienceProps) {
  const albumFetcher = useFetcher<AlbumPageResponse>();
  const initialAlbumPosts = useMemo(() => posts.filter(isAlbumPost), [posts]);
  const initialAlbumKey = useMemo(() => initialAlbumPosts.map((post) => post.id).join(","), [initialAlbumPosts]);
  const [albumPosts, setAlbumPosts] = useState<SpacePostForTheme[]>(initialAlbumPosts);
  const [albumCursor, setAlbumCursor] = useState<string | null>(initialAlbumPage?.nextCursor ?? null);
  const [albumHasMore, setAlbumHasMore] = useState(initialAlbumPage?.hasMore ?? false);

  useEffect(() => {
    setAlbumPosts(initialAlbumPosts);
    setAlbumCursor(initialAlbumPage?.nextCursor ?? null);
    setAlbumHasMore(initialAlbumPage?.hasMore ?? false);
  }, [initialAlbumKey, initialAlbumPage?.nextCursor, initialAlbumPage?.hasMore]);

  useEffect(() => {
    const albumPage = albumFetcher.data?.albumPage;
    if (!albumPage) return;

    setAlbumPosts((currentPosts) => {
      const existingIds = new Set(currentPosts.map((post) => post.id));
      const nextPosts = albumPage.items.filter((post) => !existingIds.has(post.id));
      return [...currentPosts, ...nextPosts];
    });
    setAlbumCursor(albumPage.nextCursor);
    setAlbumHasMore(albumPage.hasMore);
  }, [albumFetcher.data]);

  const loadMoreAlbum = () => {
    if (!albumHasMore || !albumCursor || albumFetcher.state !== "idle") return;
    const params = new URLSearchParams({ intent: "album_page", cursor: albumCursor });
    albumFetcher.load(`/space/${space.id}?${params.toString()}`);
  };
  const albumLoading = albumFetcher.state !== "idle";

  return (
    <main className="relative min-h-screen overflow-hidden">
      <SpaceThemeBackground themeKey={space.themeKey} />
      <div className="hidden md:block">
        <DesktopSpaceExperience
          space={space}
          posts={posts}
          albumPosts={albumPosts}
          albumHasMore={albumHasMore}
          albumLoading={albumLoading}
          onLoadMoreAlbum={loadMoreAlbum}
          initialView={initialView}
          canChangeTheme={canChangeTheme}
          showSettingsMenu={showSettingsMenu}
          allowPreviewDrag={allowPreviewDrag}
        />
      </div>
      <div className="block md:hidden">
        <MobileSpaceExperience
          space={space}
          posts={posts}
          albumPosts={albumPosts}
          albumHasMore={albumHasMore}
          albumLoading={albumLoading}
          onLoadMoreAlbum={loadMoreAlbum}
          initialView={initialView}
          canChangeTheme={canChangeTheme}
          showSettingsMenu={showSettingsMenu}
          allowPreviewDrag={allowPreviewDrag}
        />
      </div>
    </main>
  );
}

function DesktopSpaceExperience({
  space,
  posts,
  albumPosts,
  albumHasMore,
  albumLoading,
  onLoadMoreAlbum,
  initialView = "MEMORY",
  canChangeTheme,
  showSettingsMenu = true,
  allowPreviewDrag = false,
}: SpaceExperienceProps & AlbumPaginationProps) {
  const theme = getSpaceTheme(space.themeKey);
  const positionFetcher = useFetcher();
  const [view, setView] = useState<SurfaceView>(initialView);
  const [openPostIds, setOpenPostIds] = useState<number[]>([]);
  const [desktopObjectPositions, setDesktopObjectPositions] = useState<ScenePositionMap>({});
  const [selectedPhoto, setSelectedPhoto] = useState<SpacePostForTheme | null>(null);
  const messages = useMemo(
    () => posts.filter((post) => !isAlbumPost(post)).sort((a, b) => getPostSortOrder(a, "DESKTOP", "MEMORY") - getPostSortOrder(b, "DESKTOP", "MEMORY")),
    [posts]
  );
  const photos = useMemo(
    () => [...albumPosts].sort((a, b) => getPostSortOrder(a, "DESKTOP", "ALBUM") - getPostSortOrder(b, "DESKTOP", "ALBUM")),
    [albumPosts]
  );
  const canDragLocally = canChangeTheme || allowPreviewDrag;
  const desktopPositionResetKey = useMemo(() => `${space.themeKey}:${messages.map((post) => post.id).join(",")}`, [space.themeKey, messages]);

  useEffect(() => {
    setView(initialView);
  }, [initialView, space.id]);

  useEffect(() => {
    setDesktopObjectPositions({});
  }, [desktopPositionResetKey]);

  const openPost = (postId: number) => setOpenPostIds((ids) => toggleOpenId(ids, postId));
  const closePost = (postId: number) => setOpenPostIds((ids) => ids.filter((id) => id !== postId));
  const bringPostToFront = (postId: number) => setOpenPostIds((ids) => [...ids.filter((id) => id !== postId), postId]);
  const movePostObject = (postId: number, position: ScenePosition) => {
    setDesktopObjectPositions((positions) => ({ ...positions, [postId]: position }));
  };
  const savePostObject = (postId: number, position: ScenePosition) => {
    if (!canChangeTheme) return;
    const nextPosition = clampPosition(position, DESKTOP_DRAG_BOUNDS);
    setDesktopObjectPositions((positions) => ({ ...positions, [postId]: nextPosition }));
    positionFetcher.submit(
      {
        intent: "update_post_position",
        postId: String(postId),
        viewport: "DESKTOP",
        x: String(nextPosition.x),
        y: String(nextPosition.y),
      },
      { method: "post" }
    );
  };

  return (
    <div className="relative z-10 min-h-screen px-8 py-7" style={{ color: theme.textColor }}>
      <header className="flex items-start justify-between gap-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.32em]" style={{ color: theme.mutedTextColor }}>
            {theme.shortLabel}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-normal">{space.title}</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: theme.mutedTextColor }}>
            {theme.unlockedTitle}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SurfaceTabs view={view} setView={setView} memoryLabel={theme.memoryLabel} albumLabel={theme.albumLabel} />
          {showSettingsMenu && canChangeTheme && (
            <details className="relative z-[300]">
              <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-lg border border-white/15 bg-white/10 text-sm font-bold backdrop-blur-md transition hover:bg-white/15 [&::-webkit-details-marker]:hidden" aria-label="설정 열기">
                <Settings className="h-4 w-4" />
              </summary>
              <div className="absolute right-0 top-12 z-[400] w-80 rounded-lg border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl">
                <SpaceThemePicker currentThemeKey={space.themeKey} compact />
              </div>
            </details>
          )}
        </div>
      </header>

      {view === "MEMORY" ? (
        <section className="relative h-[calc(100vh-140px)]">
          <div className="absolute left-1/2 top-1/2 h-px w-px">
            {messages.map((post, index) => (
              <DesktopMemoryObject
                key={post.id}
                post={post}
                index={index}
                themeKey={space.themeKey}
                positionOverride={desktopObjectPositions[post.id]}
                onMove={canDragLocally ? (position) => movePostObject(post.id, position) : undefined}
                onCommit={canChangeTheme ? (position) => savePostObject(post.id, position) : undefined}
                onOpen={() => openPost(post.id)}
              />
            ))}
            {messages.map((post, index) => {
              if (!openPostIds.includes(post.id)) return null;
              return (
                <DesktopOpenedNoteCard
                  key={`open-${post.id}`}
                  post={post}
                  index={index}
                  themeKey={space.themeKey}
                  zIndex={100 + openPostIds.indexOf(post.id)}
                  positionOverride={desktopObjectPositions[post.id]}
                  onMove={canDragLocally ? (position) => movePostObject(post.id, position) : undefined}
                  onCommit={canChangeTheme ? (position) => savePostObject(post.id, position) : undefined}
                  onClose={() => closePost(post.id)}
                  onFocus={() => bringPostToFront(post.id)}
                />
              );
            })}
          </div>
          {messages.length === 0 && <EmptyState text="아직 작성된 쪽지가 없어요." />}
        </section>
      ) : (
        <DesktopAlbumGallery photos={photos} themeKey={space.themeKey} hasMore={albumHasMore} isLoading={albumLoading} onLoadMore={onLoadMoreAlbum} onOpenPhoto={setSelectedPhoto} />
      )}
      {selectedPhoto && <PhotoPreviewModal post={selectedPhoto} themeKey={space.themeKey} onClose={() => setSelectedPhoto(null)} />}
    </div>
  );
}

function MobileSpaceExperience({
  space,
  posts,
  albumPosts,
  albumHasMore,
  albumLoading,
  onLoadMoreAlbum,
  initialView = "MEMORY",
  canChangeTheme,
  showSettingsMenu = true,
  allowPreviewDrag = false,
}: SpaceExperienceProps & AlbumPaginationProps) {
  const theme = getSpaceTheme(space.themeKey);
  const positionFetcher = useFetcher();
  const [view, setView] = useState<SurfaceView>(initialView);
  const [readMode, setReadMode] = useState<MobileReadMode>("SCENE");
  const [openPostIds, setOpenPostIds] = useState<number[]>([]);
  const [mobileObjectPositions, setMobileObjectPositions] = useState<ScenePositionMap>({});
  const [selectedPhoto, setSelectedPhoto] = useState<SpacePostForTheme | null>(null);
  const messages = useMemo(
    () => posts.filter((post) => !isAlbumPost(post)).sort((a, b) => getPostSortOrder(a, "MOBILE", "MEMORY") - getPostSortOrder(b, "MOBILE", "MEMORY")),
    [posts]
  );
  const photos = useMemo(
    () => [...albumPosts].sort((a, b) => getPostSortOrder(a, "MOBILE", "ALBUM") - getPostSortOrder(b, "MOBILE", "ALBUM")),
    [albumPosts]
  );
  const canDragLocally = canChangeTheme || allowPreviewDrag;
  const mobilePositionResetKey = useMemo(() => `${space.themeKey}:${messages.map((post) => post.id).join(",")}`, [space.themeKey, messages]);

  useEffect(() => {
    setView(initialView);
  }, [initialView, space.id]);

  useEffect(() => {
    setMobileObjectPositions({});
  }, [mobilePositionResetKey]);

  const openPost = (postId: number) => setOpenPostIds((ids) => toggleOpenId(ids, postId));
  const closePost = (postId: number) => setOpenPostIds((ids) => ids.filter((id) => id !== postId));
  const bringPostToFront = (postId: number) => setOpenPostIds((ids) => [...ids.filter((id) => id !== postId), postId]);
  const movePostObject = (postId: number, position: ScenePosition) => {
    setMobileObjectPositions((positions) => ({ ...positions, [postId]: position }));
  };
  const savePostObject = (postId: number, position: ScenePosition) => {
    if (!canChangeTheme) return;
    const nextPosition = clampPosition(position, MOBILE_DRAG_BOUNDS);
    setMobileObjectPositions((positions) => ({ ...positions, [postId]: nextPosition }));
    positionFetcher.submit(
      {
        intent: "update_post_position",
        postId: String(postId),
        viewport: "MOBILE",
        x: String(nextPosition.x),
        y: String(nextPosition.y),
      },
      { method: "post" }
    );
  };

  return (
    <div className="relative z-10 min-h-screen px-4 pb-20 pt-5" style={{ color: theme.textColor }}>
      <div className="sticky top-3 z-[300] mb-5 flex items-start gap-2">
        <div className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/24 p-1 backdrop-blur-md">
          <SurfaceTabs view={view} setView={setView} memoryLabel={theme.memoryLabel} albumLabel={theme.albumLabel} />
        </div>
        {showSettingsMenu && (
          <MobileSpaceSettingsMenu
            readMode={readMode}
            setReadMode={setReadMode}
            showReadMode={view === "MEMORY"}
            canChangeTheme={canChangeTheme}
            currentThemeKey={space.themeKey}
          />
        )}
      </div>

      <header className="min-h-[24vh] pt-5">
        <p className="text-xs font-bold uppercase tracking-[0.28em]" style={{ color: theme.mutedTextColor }}>
          {theme.shortLabel}
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight tracking-normal">{space.title}</h1>
        <p className="mt-4 text-sm leading-relaxed" style={{ color: theme.mutedTextColor }}>
          {theme.unlockedTitle}
        </p>
      </header>

      {view === "MEMORY" && readMode === "SCENE" && (
        <MobileSceneScroller resetKey={`${space.id}:${space.themeKey}:${messages.length}`}>
          {messages.map((post, index) => (
            <MobileMemoryObject
              key={post.id}
              post={post}
              index={index}
              themeKey={space.themeKey}
              positionOverride={mobileObjectPositions[post.id]}
              onMove={canDragLocally ? (position) => movePostObject(post.id, position) : undefined}
              onCommit={canChangeTheme ? (position) => savePostObject(post.id, position) : undefined}
              onOpen={() => openPost(post.id)}
            />
          ))}
          {messages.map((post, index) => {
            if (!openPostIds.includes(post.id)) return null;
            return (
              <MobileOpenedNoteCard
                key={`mobile-open-${post.id}`}
                post={post}
                index={index}
                themeKey={space.themeKey}
                zIndex={100 + openPostIds.indexOf(post.id)}
                positionOverride={mobileObjectPositions[post.id]}
                onMove={canDragLocally ? (position) => movePostObject(post.id, position) : undefined}
                onCommit={canChangeTheme ? (position) => savePostObject(post.id, position) : undefined}
                onClose={() => closePost(post.id)}
                onFocus={() => bringPostToFront(post.id)}
              />
            );
          })}
          {messages.length === 0 && <EmptyState text="아직 작성된 쪽지가 없어요." />}
        </MobileSceneScroller>
      )}

      {view === "MEMORY" && readMode === "LIST" && <MobileAllNotesList posts={messages} themeKey={space.themeKey} />}

      {view === "ALBUM" && (
        <MobileAlbumGallery photos={photos} themeKey={space.themeKey} hasMore={albumHasMore} isLoading={albumLoading} onLoadMore={onLoadMoreAlbum} onOpenPhoto={setSelectedPhoto} />
      )}

      {selectedPhoto && <PhotoPreviewModal post={selectedPhoto} themeKey={space.themeKey} onClose={() => setSelectedPhoto(null)} />}
    </div>
  );
}

function SurfaceTabs({
  view,
  setView,
  memoryLabel,
  albumLabel,
}: {
  view: SurfaceView;
  setView: (view: SurfaceView) => void;
  memoryLabel: string;
  albumLabel: string;
}) {
  return (
    <div className="flex w-full gap-1">
      <button
        type="button"
        onClick={() => setView("MEMORY")}
        className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-bold transition md:flex-none ${
          view === "MEMORY" ? "bg-white text-slate-950 shadow-sm" : "text-white/75 hover:text-white"
        }`}
      >
        <MessageCircle className="h-4 w-4" />
        {memoryLabel}
      </button>
      <button
        type="button"
        onClick={() => setView("ALBUM")}
        className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-bold transition md:flex-none ${
          view === "ALBUM" ? "bg-white text-slate-950 shadow-sm" : "text-white/75 hover:text-white"
        }`}
      >
        <ImageIcon className="h-4 w-4" />
        {albumLabel}
      </button>
    </div>
  );
}

function MobileReadModeTabs({ mode, setMode }: { mode: MobileReadMode; setMode: (mode: MobileReadMode) => void }) {
  return (
    <div className="flex w-full gap-1">
      <button
        type="button"
        onClick={() => setMode("SCENE")}
        className={`flex-1 rounded-md px-4 py-2 text-sm font-bold transition ${mode === "SCENE" ? "bg-white text-slate-950 shadow-sm" : "text-white/75 hover:text-white"}`}
      >
        장면 보기
      </button>
      <button
        type="button"
        onClick={() => setMode("LIST")}
        className={`flex-1 rounded-md px-4 py-2 text-sm font-bold transition ${mode === "LIST" ? "bg-white text-slate-950 shadow-sm" : "text-white/75 hover:text-white"}`}
      >
        한번에 보기
      </button>
    </div>
  );
}

function MobileSceneScroller({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  const scrollerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const frame = window.requestAnimationFrame(() => {
      scroller.scrollLeft = Math.max(0, (scroller.scrollWidth - scroller.clientWidth) / 2);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [resetKey]);

  return (
    <section
      ref={scrollerRef}
      className="-mx-4 h-[58vh] min-h-[430px] overflow-x-auto overflow-y-hidden overscroll-x-contain pb-6 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="relative mx-auto h-full w-[195vw] min-w-[760px] max-w-[860px]">{children}</div>
    </section>
  );
}

function MobileSpaceSettingsMenu({
  readMode,
  setReadMode,
  showReadMode,
  canChangeTheme,
  currentThemeKey,
}: {
  readMode: MobileReadMode;
  setReadMode: (mode: MobileReadMode) => void;
  showReadMode: boolean;
  canChangeTheme?: boolean;
  currentThemeKey: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !menuRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  if (!showReadMode && !canChangeTheme) {
    return null;
  }

  return (
    <details ref={menuRef} open={isOpen} className="relative shrink-0">
      <summary
        className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg border border-white/15 bg-black/24 text-white shadow-lg backdrop-blur-md transition hover:bg-white/15 [&::-webkit-details-marker]:hidden"
        aria-label="설정 열기"
        onClick={(event) => {
          event.preventDefault();
          setIsOpen((open) => !open);
        }}
      >
        <Settings className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 top-12 z-[400] w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-white/15 bg-slate-950/90 p-3 text-white shadow-2xl backdrop-blur-xl">
        {showReadMode && (
          <section className="space-y-2">
            <p className="px-1 text-xs font-bold text-white/55">보기 방식</p>
            <div className="rounded-lg border border-white/15 bg-white/10 p-1">
              <MobileReadModeTabs mode={readMode} setMode={setReadMode} />
            </div>
          </section>
        )}
        {canChangeTheme && (
          <section className={showReadMode ? "mt-3" : ""}>
            <div className="rounded-lg bg-white p-3 text-slate-900">
              <SpaceThemePicker currentThemeKey={currentThemeKey} compact />
            </div>
          </section>
        )}
      </div>
    </details>
  );
}

function DesktopMemoryObject({
  post,
  index,
  themeKey,
  positionOverride,
  onMove,
  onCommit,
  onOpen,
}: {
  post: SpacePostForTheme;
  index: number;
  themeKey: string;
  positionOverride?: ScenePosition;
  onMove?: (position: ScenePosition) => void;
  onCommit?: (position: ScenePosition) => void;
  onOpen: () => void;
}) {
  const baseStyle = getDesktopObjectStyle(post, index);
  const style = { ...baseStyle, ...(positionOverride ?? {}) };
  const descriptor = getNoteDescriptor(themeKey, "desktop", post.id, index);
  const objectLabel = getThemeObjectLabel(themeKey);
  const { consumeClickSuppression, dragHandlers } = useSceneObjectDrag({
    position: { x: style.x, y: style.y },
    bounds: DESKTOP_DRAG_BOUNDS,
    onMove,
    onCommit,
  });
  const canDrag = Boolean(onMove);

  return (
    <button
      type="button"
      onClick={(event) => {
        if (consumeClickSuppression()) {
          event.preventDefault();
          return;
        }
        onOpen();
      }}
      aria-label={`${post.nickname}님의 쪽지 열기`}
      className={`group absolute flex h-16 w-16 items-center justify-center bg-transparent p-0 transition hover:z-20 ${
        canDrag ? "cursor-grab touch-none active:cursor-grabbing" : ""
      }`}
      style={{
        transform: `translate(${style.x}px, ${style.y}px) rotate(${style.rotation}deg) scale(${style.scale})`,
        animationDelay: `${style.delay}ms`,
      }}
      {...dragHandlers}
    >
      <span
        className="block h-10 w-10 transition duration-300 group-hover:scale-125"
        style={{
          color: descriptor.color,
          opacity: descriptor.opacity,
          transform: `rotate(${descriptor.rotation}deg) scale(${descriptor.scale})`,
          filter: `drop-shadow(0 0 10px ${descriptor.glowColor}) drop-shadow(0 0 22px ${descriptor.glowColor})`,
        }}
      >
        <AnimatedSceneShape descriptor={descriptor} />
      </span>
      <span className="pointer-events-none absolute left-1/2 top-full mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-black/40 px-3 py-1.5 text-xs font-bold text-white/85 backdrop-blur-md group-hover:block">
        {post.nickname}님의 {objectLabel}
      </span>
    </button>
  );
}

function DesktopOpenedNoteCard({
  post,
  index,
  themeKey,
  zIndex,
  positionOverride,
  onMove,
  onCommit,
  onClose,
  onFocus,
}: {
  post: SpacePostForTheme;
  index: number;
  themeKey: string;
  zIndex: number;
  positionOverride?: ScenePosition;
  onMove?: (position: ScenePosition) => void;
  onCommit?: (position: ScenePosition) => void;
  onClose: () => void;
  onFocus: () => void;
}) {
  const theme = getSpaceTheme(themeKey);
  const baseStyle = getDesktopObjectStyle(post, index);
  const style = { ...baseStyle, ...(positionOverride ?? {}) };
  const position = getDesktopNotePosition(style);
  const cardColor = getDesktopNoteCardColor(themeKey, post.id, index);
  const { dragHandlers } = useSceneObjectDrag({
    position: { x: style.x, y: style.y },
    bounds: DESKTOP_DRAG_BOUNDS,
    onMove,
    onCommit,
  });
  const canDrag = Boolean(onMove);

  return (
    <article
      className={`absolute w-80 max-w-[calc(100vw-48px)] rounded-lg border border-white/15 p-5 shadow-2xl backdrop-blur-xl ${
        canDrag ? "cursor-grab touch-none select-none active:cursor-grabbing" : ""
      }`}
      onMouseDown={onFocus}
      style={{
        zIndex,
        transform: `translate(${position.x}px, ${position.y}px)`,
        backgroundColor: cardColor,
        color: theme.inkColor,
      }}
      {...dragHandlers}
    >
      <NoteCardContent post={post} onClose={onClose} />
    </article>
  );
}

function MobileMemoryObject({
  post,
  index,
  themeKey,
  positionOverride,
  onMove,
  onCommit,
  onOpen,
}: {
  post: SpacePostForTheme;
  index: number;
  themeKey: string;
  positionOverride?: ScenePosition;
  onMove?: (position: ScenePosition) => void;
  onCommit?: (position: ScenePosition) => void;
  onOpen: () => void;
}) {
  const baseStyle = getMobileObjectStyle(post, index, themeKey);
  const style = { ...baseStyle, ...(positionOverride ?? {}) };
  const descriptor = getNoteDescriptor(themeKey, "mobile", post.id, index);
  const objectLabel = getThemeObjectLabel(themeKey);
  const { consumeClickSuppression, dragHandlers } = useSceneObjectDrag({
    position: { x: style.x, y: style.y },
    bounds: MOBILE_DRAG_BOUNDS,
    onMove,
    onCommit,
  });
  const canDrag = Boolean(onMove);

  return (
    <button
      type="button"
      onClick={(event) => {
        if (consumeClickSuppression()) {
          event.preventDefault();
          return;
        }
        onOpen();
      }}
      aria-label={`${post.nickname}님의 쪽지 열기`}
      className={`group absolute left-1/2 top-1/2 flex h-12 w-12 items-center justify-center bg-transparent p-0 transition active:scale-95 ${
        canDrag ? "cursor-grab touch-none active:cursor-grabbing" : ""
      }`}
      style={{
        transform: `translate(${style.x}px, ${style.y}px) rotate(${style.rotation}deg) scale(${style.scale})`,
        animationDelay: `${style.delay}ms`,
      }}
      {...dragHandlers}
    >
      <span
        className="block h-7 w-7"
        style={{
          color: descriptor.color,
          opacity: descriptor.opacity,
          transform: `rotate(${descriptor.rotation}deg) scale(${descriptor.scale})`,
          filter: `drop-shadow(0 0 8px ${descriptor.glowColor}) drop-shadow(0 0 16px ${descriptor.glowColor})`,
        }}
      >
        <AnimatedSceneShape descriptor={descriptor} />
      </span>
      <span className="sr-only">{objectLabel} 열기</span>
    </button>
  );
}

function MobileOpenedNoteCard({
  post,
  index,
  themeKey,
  zIndex,
  positionOverride,
  onMove,
  onCommit,
  onClose,
  onFocus,
}: {
  post: SpacePostForTheme;
  index: number;
  themeKey: string;
  zIndex: number;
  positionOverride?: ScenePosition;
  onMove?: (position: ScenePosition) => void;
  onCommit?: (position: ScenePosition) => void;
  onClose: () => void;
  onFocus: () => void;
}) {
  const theme = getSpaceTheme(themeKey);
  const baseStyle = getMobileObjectStyle(post, index, themeKey);
  const style = { ...baseStyle, ...(positionOverride ?? {}) };
  const position = getMobileNotePosition(style);
  const { dragHandlers } = useSceneObjectDrag({
    position: { x: style.x, y: style.y },
    bounds: MOBILE_DRAG_BOUNDS,
    onMove,
    onCommit,
  });
  const canDrag = Boolean(onMove);

  return (
    <article
      className={`absolute left-1/2 top-1/2 w-[min(82vw,320px)] max-h-64 overflow-y-auto rounded-lg border border-white/15 p-4 shadow-2xl backdrop-blur-xl ${
        canDrag ? "cursor-grab touch-none select-none active:cursor-grabbing" : ""
      }`}
      onMouseDown={onFocus}
      onTouchStart={onFocus}
      style={{
        zIndex,
        transform: `translate(${position.x}px, ${position.y}px)`,
        backgroundColor: theme.cardColor,
        color: theme.inkColor,
      }}
      {...dragHandlers}
    >
      <NoteCardContent post={post} onClose={onClose} compact />
    </article>
  );
}

function NoteCardContent({
  post,
  onClose,
  compact = false,
}: {
  post: SpacePostForTheme;
  onClose: () => void;
  compact?: boolean;
}) {
  return (
    <>
      <div className="mb-3 flex items-start justify-between gap-3 border-b border-black/10 pb-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-50">From</p>
          <h2 className="text-sm font-bold">{post.nickname}</h2>
        </div>
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onClose} className="rounded-full p-1.5 text-current opacity-60 transition hover:bg-black/10 hover:opacity-100" aria-label="닫기">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className={`${compact ? "text-sm" : "text-base"} whitespace-pre-wrap leading-relaxed`}>{post.content}</p>
      <p className="mt-4 text-xs font-bold opacity-45">{formatDate(post.createdAt)}</p>
    </>
  );
}

function MobileAllNotesList({ posts, themeKey }: { posts: SpacePostForTheme[]; themeKey: string }) {
  const theme = getSpaceTheme(themeKey);

  return (
    <section className="space-y-4 pb-10">
      {posts.map((post, index) => {
        const descriptor = getNoteDescriptor(themeKey, "mobile", post.id, index);
        return (
          <article key={post.id} className="rounded-lg border border-white/15 p-4 shadow-xl backdrop-blur-xl" style={{ backgroundColor: theme.cardColor, color: theme.inkColor }}>
            <div className="mb-3 flex items-start gap-3 border-b border-black/10 pb-3">
              <span
                className="block h-10 w-10 shrink-0"
                style={{
                  color: descriptor.color,
                  filter: `drop-shadow(0 0 14px ${descriptor.glowColor})`,
                }}
              >
                <AnimatedSceneShape descriptor={descriptor} />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-50">From</p>
                <h2 className="text-sm font-bold">{post.nickname}</h2>
              </div>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{post.content}</p>
            <p className="mt-4 text-xs font-bold opacity-45">{formatDate(post.createdAt)}</p>
          </article>
        );
      })}
      {posts.length === 0 && <EmptyState text="아직 작성된 쪽지가 없어요." />}
    </section>
  );
}

function DesktopAlbumGallery({
  photos,
  themeKey,
  hasMore,
  isLoading,
  onLoadMore,
  onOpenPhoto,
}: {
  photos: SpacePostForTheme[];
  themeKey: string;
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  onOpenPhoto: (post: SpacePostForTheme) => void;
}) {
  const theme = getSpaceTheme(themeKey);
  const galleryClass = {
    galaxy: "relative mx-auto grid min-h-[560px] max-w-6xl grid-cols-3 items-start gap-7 xl:grid-cols-4",
    camping_night: "relative mx-auto grid min-h-[560px] max-w-6xl grid-cols-3 items-start gap-x-9 gap-y-16 pt-12 xl:grid-cols-4",
    spring_petals: "relative mx-auto grid min-h-[560px] max-w-6xl grid-cols-3 items-start gap-8 xl:grid-cols-4",
    summer_sea: "relative mx-auto grid min-h-[560px] max-w-6xl grid-cols-3 items-start gap-7 xl:grid-cols-4",
    autumn_leaves: "relative mx-auto grid min-h-[560px] max-w-6xl grid-cols-3 items-start gap-8 xl:grid-cols-4",
    winter_snow: "relative mx-auto grid min-h-[560px] max-w-6xl grid-cols-3 items-start gap-7 xl:grid-cols-4",
    film_polaroid: "relative mx-auto grid min-h-[560px] max-w-7xl grid-cols-4 items-start gap-4 xl:grid-cols-5",
    birthday_party: "relative mx-auto grid min-h-[560px] max-w-6xl grid-cols-3 items-start gap-7 xl:grid-cols-4",
  }[theme.key];

  return (
    <section className="h-[calc(100vh-140px)] overflow-y-auto pb-16 pt-8">
      <div className={galleryClass ?? "relative mx-auto grid min-h-[560px] max-w-6xl grid-cols-3 items-start gap-7 xl:grid-cols-4"}>
        <DesktopAlbumBackdrop themeKey={themeKey} />
        {photos.map((post, index) => (
          <DesktopAlbumCard key={post.id} post={post} index={index} themeKey={themeKey} onOpen={() => onOpenPhoto(post)} />
        ))}
      </div>
      <AlbumLoadMoreButton hasMore={hasMore} isLoading={isLoading} onLoadMore={onLoadMore} />
      {photos.length === 0 && <EmptyState text="아직 올려진 사진이 없어요." />}
    </section>
  );
}

function DesktopAlbumBackdrop({ themeKey }: { themeKey: string }) {
  const theme = getSpaceTheme(themeKey);

  if (theme.key === "film_polaroid") {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-12 z-0 h-[72%] rounded-lg border border-amber-100/10 bg-neutral-950/30 shadow-[inset_0_0_80px_rgba(0,0,0,0.35)]" aria-hidden="true">
        <div className="absolute inset-x-8 top-1/2 h-px bg-amber-100/15" />
        <AlbumMotif themeKey={themeKey} index={41} shape="light-leak" className="left-[8%] top-[12%] h-24 w-24 opacity-45" />
        <AlbumMotif themeKey={themeKey} index={42} shape="film-strip" className="right-[7%] top-[62%] h-20 w-20 rotate-12 opacity-35" />
      </div>
    );
  }

  if (theme.key === "camping_night") {
    return (
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        <span className="absolute left-4 right-4 top-12 h-px bg-orange-100/40 shadow-[0_0_18px_rgba(251,146,60,0.45)]" />
        <span className="absolute left-10 right-16 top-[52%] h-px bg-orange-100/25 shadow-[0_0_16px_rgba(251,146,60,0.35)]" />
        <AlbumMotif themeKey={themeKey} index={51} shape="lantern" className="right-[10%] top-0 h-16 w-16" />
        <AlbumMotif themeKey={themeKey} index={52} shape="ember" className="bottom-[12%] left-[4%] h-14 w-14 opacity-55" />
      </div>
    );
  }

  if (theme.key === "autumn_leaves") {
    return (
      <div className="pointer-events-none absolute inset-0 z-0 rounded-lg bg-orange-950/10" aria-hidden="true">
        <AlbumMotif themeKey={themeKey} index={61} shape="maple" className="left-[2%] top-[8%] h-20 w-20 rotate-[-18deg] opacity-55" />
        <AlbumMotif themeKey={themeKey} index={62} shape="ginkgo" className="right-[6%] top-[18%] h-16 w-16 rotate-12 opacity-50" />
        <AlbumMotif themeKey={themeKey} index={63} shape="oak" className="bottom-[4%] left-[45%] h-[72px] w-[72px] rotate-[22deg] opacity-45" />
      </div>
    );
  }

  if (theme.key === "winter_snow") {
    return (
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-lg border border-white/10 bg-white/5" aria-hidden="true">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(255,255,255,0.18),transparent_24%),radial-gradient(circle_at_84%_12%,rgba(147,197,253,0.18),transparent_28%)]" />
        <AlbumMotif themeKey={themeKey} index={71} shape="snowflake" className="left-[7%] top-[10%] h-14 w-14 opacity-65" />
        <AlbumMotif themeKey={themeKey} index={72} shape="ice-crystal" className="bottom-[10%] right-[9%] h-16 w-16 rotate-12 opacity-55" />
      </div>
    );
  }

  if (theme.key === "summer_sea") {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[62%] overflow-hidden rounded-lg" aria-hidden="true">
        <div className="absolute inset-x-0 bottom-0 h-44 bg-cyan-300/15" style={{ clipPath: "polygon(0 42%, 13% 32%, 26% 48%, 42% 35%, 57% 50%, 72% 36%, 100% 45%, 100% 100%, 0 100%)" }} />
        <AlbumMotif themeKey={themeKey} index={81} shape="wave" className="bottom-[18%] left-[5%] h-24 w-24 opacity-50" />
        <AlbumMotif themeKey={themeKey} index={82} shape="bubble" className="right-[12%] top-[12%] h-14 w-14 opacity-50" />
        <AlbumMotif themeKey={themeKey} index={83} shape="water-shine" className="left-[52%] top-[20%] h-10 w-10 opacity-55" />
      </div>
    );
  }

  if (theme.key === "spring_petals") {
    return (
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        <AlbumMotif themeKey={themeKey} index={91} shape="flower" className="left-[4%] top-[12%] h-14 w-14 opacity-55" />
        <AlbumMotif themeKey={themeKey} index={92} shape="cherry-petal" className="right-[9%] top-[8%] h-12 w-12 rotate-12 opacity-60" />
        <AlbumMotif themeKey={themeKey} index={93} shape="round-petal" className="bottom-[8%] left-[48%] h-11 w-11 rotate-[-14deg] opacity-50" />
      </div>
    );
  }

  if (theme.key === "birthday_party") {
    return (
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-lg" aria-hidden="true">
        <span className="absolute left-0 top-8 h-8 w-full rotate-[-2deg] bg-pink-300/15" />
        <span className="absolute left-0 top-20 h-5 w-full rotate-[3deg] bg-yellow-200/15" />
        <AlbumMotif themeKey={themeKey} index={101} shape="balloon" className="right-[8%] top-[12%] h-20 w-20 opacity-60" />
        <AlbumMotif themeKey={themeKey} index={102} shape="confetti" className="bottom-[16%] left-[5%] h-14 w-14 rotate-12 opacity-60" />
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
      <span className="absolute left-[8%] top-[20%] h-px w-[72%] rotate-[7deg] bg-white/12" />
      <span className="absolute left-[16%] top-[58%] h-px w-[56%] rotate-[-12deg] bg-white/10" />
      <span className="absolute left-[30%] top-[18%] h-[54%] w-px rotate-[22deg] bg-white/10" />
      <AlbumMotif themeKey={themeKey} index={31} shape="starburst" className="left-[5%] top-[10%] h-12 w-12 opacity-65" />
      <AlbumMotif themeKey={themeKey} index={32} shape="sparkle" className="bottom-[16%] right-[8%] h-10 w-10 opacity-60" />
    </div>
  );
}

function DesktopAlbumCaption({
  post,
  className = "",
  mutedClassName = "opacity-55",
}: {
  post: SpacePostForTheme;
  className?: string;
  mutedClassName?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="whitespace-normal break-words text-sm font-bold leading-snug [overflow-wrap:anywhere]">{post.content || post.nickname}</p>
      <p className={`mt-2 whitespace-normal break-words text-xs leading-snug [overflow-wrap:anywhere] ${mutedClassName}`}>
        {post.nickname} / {formatDate(post.createdAt)}
      </p>
    </div>
  );
}

function DesktopAlbumCard({
  post,
  index,
  themeKey,
  onOpen,
}: {
  post: SpacePostForTheme;
  index: number;
  themeKey: string;
  onOpen: () => void;
}) {
  const appearance = getPostAppearance(post, "DESKTOP", "ALBUM");
  const style = parseDesktopAlbumStyle(appearance?.style, index);
  const theme = getSpaceTheme(themeKey);
  const transformStyle: CSSProperties = {
    transform: `rotate(${style.rotation}deg) translateY(${style.offsetY}px)`,
    animationDelay: `${style.delay}ms`,
  };
  const featuredGridClass = style.featured ? "col-span-2" : "";

  if (theme.key === "film_polaroid") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`relative z-10 overflow-hidden rounded-lg bg-neutral-950 px-7 py-5 text-left shadow-2xl transition hover:brightness-110 ${style.featured ? "col-span-2" : ""}`}
        style={transformStyle}
      >
        <FilmSprockets side="left" />
        <FilmSprockets side="right" />
        <div className="border border-amber-100/20 bg-neutral-900 p-2">
          <AlbumImage post={post} className={style.featured ? "aspect-[16/9] overflow-hidden bg-stone-800" : "aspect-[4/3] overflow-hidden bg-stone-800"} />
        </div>
        <DesktopAlbumCaption post={post} className="px-1 pt-3 font-mono text-amber-50" mutedClassName="text-amber-200/55" />
      </button>
    );
  }

  if (theme.key === "camping_night") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`relative z-10 overflow-visible rounded-lg bg-orange-50 p-4 pb-5 text-left shadow-2xl transition hover:brightness-105 ${style.featured ? "col-span-2" : ""}`}
        style={transformStyle}
      >
        <span className="absolute left-9 top-0 h-8 w-3 -translate-y-6 rounded-sm bg-amber-300 shadow-sm" aria-hidden="true" />
        <span className="absolute right-12 top-0 h-8 w-3 -translate-y-6 rounded-sm bg-orange-300 shadow-sm" aria-hidden="true" />
        <AlbumMotif themeKey={themeKey} index={index} shape={index % 2 === 0 ? "lantern" : "ember"} className="-right-4 -top-8 h-12 w-12" />
        <AlbumImage post={post} className={style.featured ? "aspect-[16/10] overflow-hidden rounded-md bg-stone-200" : "aspect-[5/4] overflow-hidden rounded-md bg-stone-200"} />
        <DesktopAlbumCaption post={post} className="pt-3 text-stone-800" mutedClassName="text-stone-500" />
      </button>
    );
  }

  if (theme.key === "autumn_leaves") {
    return (
      <button type="button" onClick={onOpen} className={`relative z-10 rounded-lg bg-orange-50 p-4 text-left shadow-2xl transition hover:brightness-105 ${featuredGridClass}`} style={transformStyle}>
        <span className="absolute left-1/2 top-0 h-6 w-28 -translate-x-1/2 -translate-y-1/2 rotate-[-3deg] bg-amber-200/80 shadow-sm" aria-hidden="true" />
        <AlbumMotif themeKey={themeKey} index={index} shape={index % 2 === 0 ? "maple" : "ginkgo"} className="-left-5 -top-5 h-14 w-14 rotate-[-18deg]" />
        <AlbumMotif themeKey={themeKey} index={index + 12} shape={index % 3 === 0 ? "oak" : "leaf-chip"} className="-bottom-4 right-5 h-10 w-10 rotate-[18deg]" />
        <AlbumImage post={post} className={style.featured ? "aspect-[4/3] overflow-hidden bg-amber-100" : "aspect-square overflow-hidden bg-amber-100"} />
        <DesktopAlbumCaption post={post} className="mt-3 border-t border-orange-900/10 pt-3 text-orange-950" mutedClassName="text-orange-900/55" />
      </button>
    );
  }

  if (theme.key === "winter_snow") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`relative z-10 overflow-hidden rounded-lg border border-white/70 bg-blue-50/90 p-3 text-left shadow-[0_18px_42px_rgba(219,234,254,0.28)] backdrop-blur-md transition hover:brightness-105 ${featuredGridClass}`}
        style={transformStyle}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(255,255,255,0.9),transparent_22%),radial-gradient(circle_at_88%_0%,rgba(147,197,253,0.34),transparent_28%)]" />
        <AlbumMotif themeKey={themeKey} index={index} shape={index % 2 === 0 ? "snowflake" : "ice-crystal"} className="right-3 top-3 h-9 w-9 opacity-80" />
        <AlbumImage post={post} className={style.featured ? "relative aspect-[4/3] overflow-hidden rounded-md border border-white/80 bg-slate-100" : "relative aspect-square overflow-hidden rounded-md border border-white/80 bg-slate-100"} />
        <DesktopAlbumCaption post={post} className="relative px-2 py-3 text-blue-950" mutedClassName="text-blue-900/50" />
      </button>
    );
  }

  if (theme.key === "summer_sea") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`relative z-10 overflow-hidden rounded-lg bg-cyan-50 text-left shadow-2xl transition hover:brightness-105 ${style.featured ? "col-span-2" : ""}`}
        style={transformStyle}
      >
        <AlbumImage post={post} className={style.featured ? "aspect-[16/9] overflow-hidden bg-cyan-100" : "aspect-[16/11] overflow-hidden bg-cyan-100"} />
        <div className="absolute inset-x-0 top-[calc(100%-6rem)] h-12 bg-cyan-300/55" style={{ clipPath: "polygon(0 42%, 20% 62%, 42% 36%, 68% 58%, 100% 35%, 100% 100%, 0 100%)" }} />
        <AlbumMotif themeKey={themeKey} index={index} shape="bubble" className="right-5 top-5 h-9 w-9 opacity-75" />
        <AlbumMotif themeKey={themeKey} index={index + 5} shape="water-shine" className="left-6 top-6 h-7 w-7 opacity-70" />
        <DesktopAlbumCaption post={post} className="relative p-4 text-cyan-950" mutedClassName="text-cyan-800/55" />
      </button>
    );
  }

  if (theme.key === "spring_petals") {
    return (
      <button type="button" onClick={onOpen} className={`relative z-10 rounded-lg bg-rose-50 p-4 text-left shadow-2xl transition hover:brightness-105 ${featuredGridClass}`} style={transformStyle}>
        <AlbumMotif themeKey={themeKey} index={index} shape={index % 3 === 0 ? "flower" : "cherry-petal"} className="-right-4 -top-4 h-12 w-12 rotate-12" />
        <AlbumMotif themeKey={themeKey} index={index + 9} shape="round-petal" className="-bottom-3 left-5 h-9 w-9 -rotate-12" />
        <AlbumImage post={post} className={style.featured ? "aspect-[4/3] overflow-hidden rounded-md bg-rose-100" : "aspect-square overflow-hidden rounded-md bg-rose-100"} />
        <DesktopAlbumCaption post={post} className="pt-3 text-rose-950" mutedClassName="text-rose-800/50" />
      </button>
    );
  }

  if (theme.key === "birthday_party") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`relative z-10 overflow-hidden rounded-lg bg-pink-50 p-4 text-left shadow-2xl transition hover:brightness-105 ${featuredGridClass}`}
        style={transformStyle}
      >
        <span className="absolute -right-12 top-6 h-8 w-40 rotate-45 bg-yellow-300/80" aria-hidden="true" />
        <span className="absolute left-0 top-0 h-2 w-full bg-[linear-gradient(90deg,#f9a8d4,#fde68a,#93c5fd,#c4b5fd)]" aria-hidden="true" />
        <AlbumMotif themeKey={themeKey} index={index} shape={index % 2 === 0 ? "confetti" : "party-star"} className="left-3 top-4 h-9 w-9" />
        <AlbumMotif themeKey={themeKey} index={index + 7} shape="ribbon" className="bottom-3 right-4 h-11 w-11" />
        <AlbumImage post={post} className={style.featured ? "relative aspect-[4/3] overflow-hidden rounded-md bg-pink-100" : "relative aspect-square overflow-hidden rounded-md bg-pink-100"} />
        <DesktopAlbumCaption post={post} className="relative mt-3 rounded-md bg-white/70 px-3 py-2 text-pink-950" mutedClassName="text-pink-800/55" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`relative z-10 overflow-hidden rounded-lg border border-white/18 bg-slate-950/72 p-3 text-left shadow-2xl backdrop-blur-md transition hover:brightness-110 ${featuredGridClass}`}
      style={transformStyle}
    >
      <span className="absolute left-5 top-5 h-px w-[calc(100%-2.5rem)] bg-white/12" aria-hidden="true" />
      <span className="absolute bottom-5 left-5 h-px w-[calc(100%-2.5rem)] bg-white/10" aria-hidden="true" />
      <AlbumMotif themeKey={themeKey} index={index} shape={index % 2 === 0 ? "star" : "sparkle"} className="right-4 top-4 h-8 w-8" />
      <AlbumImage post={post} className={style.featured ? "aspect-[4/3] overflow-hidden rounded-md bg-slate-900" : "aspect-square overflow-hidden rounded-md bg-slate-900"} />
      <DesktopAlbumCaption post={post} className="px-2 py-3 text-white" mutedClassName="text-white/55" />
    </button>
  );
}

function MobileAlbumGallery({
  photos,
  themeKey,
  hasMore,
  isLoading,
  onLoadMore,
  onOpenPhoto,
}: {
  photos: SpacePostForTheme[];
  themeKey: string;
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  onOpenPhoto: (post: SpacePostForTheme) => void;
}) {
  const theme = getSpaceTheme(themeKey);
  const galleryClass = {
    galaxy: "relative space-y-5 pb-10 pl-7 before:absolute before:left-3 before:top-8 before:h-[calc(100%-4rem)] before:w-px before:bg-white/18",
    camping_night: "relative space-y-8 pb-10",
    spring_petals: "relative space-y-5 pb-10",
    summer_sea: "relative space-y-5 pb-10",
    autumn_leaves: "relative space-y-6 pb-10",
    winter_snow: "relative space-y-5 pb-10",
    film_polaroid: "relative -mx-1 space-y-0 pb-10",
    birthday_party: "relative space-y-5 pb-10",
  }[theme.key];

  return (
    <section className={galleryClass ?? "relative space-y-5 pb-10"}>
      {photos.map((post, index) => (
        <MobileAlbumCard key={post.id} post={post} index={index} themeKey={themeKey} onOpen={() => onOpenPhoto(post)} />
      ))}
      <AlbumLoadMoreButton hasMore={hasMore} isLoading={isLoading} onLoadMore={onLoadMore} />
      {photos.length === 0 && <EmptyState text="아직 올려진 사진이 없어요." />}
    </section>
  );
}

function AlbumLoadMoreButton({ hasMore, isLoading, onLoadMore }: { hasMore: boolean; isLoading: boolean; onLoadMore: () => void }) {
  if (!hasMore) return null;

  return (
    <div className="relative z-20 mt-8 flex justify-center">
      <button
        type="button"
        onClick={onLoadMore}
        disabled={isLoading}
        className="rounded-lg border border-white/15 bg-white/12 px-5 py-3 text-sm font-bold text-white shadow-lg backdrop-blur-md transition hover:bg-white/18 disabled:cursor-wait disabled:opacity-60"
      >
        {isLoading ? "사진 불러오는 중..." : "사진 더 보기"}
      </button>
    </div>
  );
}

function AlbumMotif({
  themeKey,
  index,
  shape,
  className,
  style,
}: {
  themeKey: string;
  index: number;
  shape: SceneShape;
  className: string;
  style?: CSSProperties;
}) {
  const descriptor = getSceneObjectDescriptor({
    themeKey,
    seed: `${themeKey}:album-motif:${index}:${shape}`,
    interactive: true,
  });

  return (
    <span
      className={`pointer-events-none absolute block ${className}`}
      style={{
        color: descriptor.color,
        filter: `drop-shadow(0 0 12px ${descriptor.glowColor})`,
        ...style,
      }}
      aria-hidden="true"
    >
      <SceneShapeView shape={shape} descriptor={descriptor} />
    </span>
  );
}

function AlbumImage({
  post,
  className,
  imageClassName = "h-full w-full object-cover",
}: {
  post: SpacePostForTheme;
  className: string;
  imageClassName?: string;
}) {
  const imageUrl = post.thumbnailUrl || post.mediaUrl;
  return <div className={className}>{imageUrl ? <img src={imageUrl} alt="" className={imageClassName} loading="lazy" /> : null}</div>;
}

function MobileAlbumCaption({ post, className = "", mutedClassName = "opacity-55" }: { post: SpacePostForTheme; className?: string; mutedClassName?: string }) {
  return (
    <div className={className}>
      <p className="line-clamp-3 text-sm font-bold">{post.content || post.nickname}</p>
      <p className={`mt-2 text-xs ${mutedClassName}`}>
        {post.nickname} / {formatDate(post.createdAt)}
      </p>
    </div>
  );
}

function FilmSprockets({ side }: { side: "left" | "right" }) {
  return (
    <span className={`pointer-events-none absolute top-3 flex h-[calc(100%-1.5rem)] w-3 flex-col justify-between ${side === "left" ? "left-2" : "right-2"}`} aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <span key={index} className="h-3 w-2 rounded-sm bg-white/80" />
      ))}
    </span>
  );
}

function MobileAlbumCard({
  post,
  index,
  themeKey,
  onOpen,
}: {
  post: SpacePostForTheme;
  index: number;
  themeKey: string;
  onOpen: () => void;
}) {
  const theme = getSpaceTheme(themeKey);
  const appearance = getPostAppearance(post, "MOBILE", "ALBUM");
  const style = parseMobileCardStyle(appearance?.style, index);
  const offsetX = clampNumber(style.lane * 8 + style.offsetX, -18, 18);
  const offsetY = clampNumber(style.offsetY, -8, 14);
  const rotation = clampNumber(style.rotation, -4, 4);
  const baseButtonStyle: CSSProperties = {
    marginLeft: `${offsetX}px`,
    transform: `translateY(${offsetY}px) rotate(${rotation}deg) scale(${style.scale})`,
    animationDelay: `${style.delay}ms`,
  };

  if (theme.key === "film_polaroid") {
    return (
      <div className="relative px-5 py-3">
        <button
          type="button"
          onClick={onOpen}
          className="relative w-full overflow-hidden rounded-lg bg-neutral-950 px-6 py-4 text-left shadow-2xl transition active:scale-[0.99]"
          style={baseButtonStyle}
        >
          <FilmSprockets side="left" />
          <FilmSprockets side="right" />
          <div className="border border-amber-100/20 bg-neutral-900 p-2">
            <AlbumImage post={post} className="aspect-[4/3] overflow-hidden bg-stone-800" />
          </div>
          <MobileAlbumCaption post={post} className="px-1 pt-3 font-mono text-amber-50" mutedClassName="text-amber-200/55" />
        </button>
      </div>
    );
  }

  if (theme.key === "camping_night") {
    return (
      <div className="relative pt-5">
        <span className="absolute left-3 right-3 top-4 h-px bg-orange-100/45 shadow-[0_0_12px_rgba(251,146,60,0.45)]" aria-hidden="true" />
        <button
          type="button"
          onClick={onOpen}
          className="relative w-[92%] overflow-visible rounded-lg bg-orange-50 p-3 pb-4 text-left shadow-xl transition active:scale-[0.99]"
          style={{ ...baseButtonStyle, marginLeft: index % 2 === 0 ? "4px" : "22px" }}
        >
          <span className="absolute left-8 top-0 h-7 w-3 -translate-y-5 rounded-sm bg-amber-300 shadow-sm" aria-hidden="true" />
          <span className="absolute right-10 top-0 h-7 w-3 -translate-y-5 rounded-sm bg-orange-300 shadow-sm" aria-hidden="true" />
          <AlbumMotif themeKey={themeKey} index={index} shape="lantern" className="-right-3 -top-6 h-9 w-9" />
          <AlbumImage post={post} className="aspect-[5/4] overflow-hidden rounded-md bg-stone-200" />
          <MobileAlbumCaption post={post} className="pt-3 text-stone-800" mutedClassName="text-stone-500" />
        </button>
      </div>
    );
  }

  if (theme.key === "autumn_leaves") {
    return (
      <div className={index % 2 === 0 ? "relative pr-5" : "relative pl-5"}>
        <button
          type="button"
          onClick={onOpen}
          className="relative w-full rounded-lg bg-orange-50 p-3 text-left shadow-xl transition active:scale-[0.99]"
          style={baseButtonStyle}
        >
          <span className="absolute left-1/2 top-0 h-5 w-24 -translate-x-1/2 -translate-y-1/2 rotate-[-3deg] bg-amber-200/80 shadow-sm" aria-hidden="true" />
          <AlbumMotif themeKey={themeKey} index={index} shape={index % 2 === 0 ? "maple" : "ginkgo"} className="-left-4 -top-4 h-12 w-12 rotate-[-18deg]" />
          <AlbumMotif themeKey={themeKey} index={index + 12} shape="leaf-chip" className="-bottom-3 right-4 h-8 w-8 rotate-[18deg]" />
          <AlbumImage post={post} className="aspect-[4/3] overflow-hidden bg-amber-100" />
          <MobileAlbumCaption post={post} className="mt-3 border-t border-orange-900/10 pt-3 text-orange-950" mutedClassName="text-orange-900/55" />
        </button>
      </div>
    );
  }

  if (theme.key === "winter_snow") {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          className="relative w-full overflow-hidden rounded-lg border border-white/70 bg-blue-50/95 p-2 text-left shadow-[0_16px_36px_rgba(219,234,254,0.28)] transition active:scale-[0.99]"
          style={baseButtonStyle}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(255,255,255,0.9),transparent_22%),radial-gradient(circle_at_88%_0%,rgba(147,197,253,0.34),transparent_28%)]" />
          <AlbumMotif themeKey={themeKey} index={index} shape="snowflake" className="right-2 top-2 h-7 w-7 opacity-80" />
          <AlbumImage post={post} className="relative aspect-[4/3] overflow-hidden rounded-md border border-white/80 bg-slate-100" />
          <MobileAlbumCaption post={post} className="relative px-2 py-3 text-blue-950" mutedClassName="text-blue-900/50" />
        </button>
      </div>
    );
  }

  if (theme.key === "summer_sea") {
    return (
      <div className={index % 2 === 0 ? "relative pr-3" : "relative pl-3"}>
        <button
          type="button"
          onClick={onOpen}
          className="relative w-full overflow-hidden rounded-lg bg-cyan-50 text-left shadow-xl transition active:scale-[0.99]"
          style={baseButtonStyle}
        >
          <AlbumImage post={post} className="aspect-[16/10] overflow-hidden bg-cyan-100" />
          <div className="absolute inset-x-0 top-[calc(100%-5.5rem)] h-10 bg-cyan-300/55" style={{ clipPath: "polygon(0 42%, 20% 62%, 42% 36%, 68% 58%, 100% 35%, 100% 100%, 0 100%)" }} />
          <AlbumMotif themeKey={themeKey} index={index} shape="bubble" className="right-4 top-4 h-7 w-7 opacity-75" />
          <AlbumMotif themeKey={themeKey} index={index + 5} shape="water-shine" className="left-5 top-5 h-6 w-6 opacity-70" />
          <MobileAlbumCaption post={post} className="relative p-4 text-cyan-950" mutedClassName="text-cyan-800/55" />
        </button>
      </div>
    );
  }

  if (theme.key === "spring_petals") {
    return (
      <div className={index % 2 === 0 ? "relative pr-5" : "relative pl-5"}>
        <button
          type="button"
          onClick={onOpen}
          className="relative w-full rounded-lg bg-rose-50 p-3 text-left shadow-xl transition active:scale-[0.99]"
          style={baseButtonStyle}
        >
          <AlbumMotif themeKey={themeKey} index={index} shape="cherry-petal" className="-right-3 -top-3 h-9 w-9 rotate-12" />
          <AlbumMotif themeKey={themeKey} index={index + 9} shape="round-petal" className="-bottom-2 left-4 h-7 w-7 -rotate-12" />
          <AlbumImage post={post} className="aspect-[4/3] overflow-hidden rounded-md bg-rose-100" />
          <MobileAlbumCaption post={post} className="pt-3 text-rose-950" mutedClassName="text-rose-800/50" />
        </button>
      </div>
    );
  }

  if (theme.key === "birthday_party") {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          className="relative w-full overflow-hidden rounded-lg bg-pink-50 p-3 text-left shadow-xl transition active:scale-[0.99]"
          style={baseButtonStyle}
        >
          <span className="absolute -right-10 top-5 h-7 w-32 rotate-45 bg-yellow-300/80" aria-hidden="true" />
          <AlbumMotif themeKey={themeKey} index={index} shape="confetti" className="left-2 top-2 h-8 w-8" />
          <AlbumMotif themeKey={themeKey} index={index + 7} shape="ribbon" className="bottom-2 right-3 h-9 w-9" />
          <AlbumImage post={post} className="relative aspect-[4/3] overflow-hidden rounded-md bg-pink-100" />
          <MobileAlbumCaption post={post} className="relative mt-3 rounded-md bg-white/70 px-3 py-2 text-pink-950" mutedClassName="text-pink-800/55" />
        </button>
      </div>
    );
  }

  return (
    <div className={index % 2 === 0 ? "relative pr-4" : "relative pl-4"}>
      <span className="absolute -left-6 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white shadow-[0_0_16px_rgba(255,255,255,0.9)]" aria-hidden="true" />
      <button
        type="button"
        onClick={onOpen}
        className="relative w-full overflow-hidden rounded-lg border border-white/18 bg-slate-950/72 p-2 text-left shadow-2xl backdrop-blur-md transition active:scale-[0.99]"
        style={baseButtonStyle}
      >
        <AlbumMotif themeKey={themeKey} index={index} shape="star" className="right-3 top-3 h-6 w-6" />
        <AlbumImage post={post} className="aspect-[4/3] overflow-hidden rounded-md bg-slate-900" />
        <MobileAlbumCaption post={post} className="px-2 py-3 text-white" mutedClassName="text-white/55" />
      </button>
    </div>
  );
}

function PhotoPreviewModal({ post, themeKey, onClose }: { post: SpacePostForTheme; themeKey: string; onClose: () => void }) {
  const theme = getSpaceTheme(themeKey);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4 backdrop-blur-md" onClick={onClose}>
      <article
        className="max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-white/15 shadow-2xl"
        style={{ backgroundColor: theme.cardColor, color: theme.inkColor }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] opacity-50">From</p>
            <h2 className="text-lg font-bold">{post.nickname}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-current opacity-60 transition hover:bg-black/10 hover:opacity-100" aria-label="닫기">
            <X className="h-5 w-5" />
          </button>
        </div>
        {(post.mediaUrl || post.thumbnailUrl) && (
          <div className="bg-black/5">
            <img src={post.mediaUrl || post.thumbnailUrl || ""} alt="" className="max-h-[56vh] w-full object-contain" />
          </div>
        )}
        <div className="space-y-4 px-5 py-5">
          <p className="whitespace-pre-wrap text-base leading-relaxed">{post.content}</p>
          <p className="text-xs font-bold opacity-50">{formatDate(post.createdAt)}</p>
        </div>
      </article>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="relative z-10 mx-auto mt-16 max-w-sm rounded-lg border border-white/15 bg-white/10 p-8 text-center text-sm text-white/70 backdrop-blur-md">{text}</div>;
}
