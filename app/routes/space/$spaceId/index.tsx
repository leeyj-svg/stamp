import { useEffect, useState } from "react";
import { useLoaderData, Form, useActionData } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { db } from "~/lib/db.server";
import { getSession } from "~/lib/auth.server";
import GalaxyMessageCard from "~/components/GalaxyMessageCard";
import SpaceBackground from "~/components/SpaceBackground";
import SpaceAlbum from "~/components/SpaceAlbum";
import AlbumBackground from "~/components/AlbumBackground";
import { FolderOpen } from "@phosphor-icons/react";
import { FolderClosed } from "lucide-react";
import { parseSpaceAiStyle, type SpacePost } from "~/lib/space-post";

// 🔐 [Action] 비밀번호 확인 (손님용)
export async function action({ request, params }: ActionFunctionArgs) {
    if (!params.spaceId) {
        throw new Response("Not Found", { status: 404 });
    }

    const formData = await request.formData();
    const intent = formData.get("intent");

    // ✨ 1. 위치 저장 로직 (드래그 앤 드롭 저장)
    if (intent === "move_post") {
        const { user } = await getSession(request);
        const postId = Number(formData.get("postId"));
        const x = Number(formData.get("x"));
        const y = Number(formData.get("y"));

        if (!user || Number.isNaN(postId) || Number.isNaN(x) || Number.isNaN(y)) {
            return { success: false };
        }

        const post = await db.memoryPost.findUnique({
            where: { id: postId },
            select: {
                id: true,
                spaceId: true,
                aiStyle: true,
                space: {
                    select: {
                        userId: true,
                    },
                },
            },
        });
        if (!post) return { success: false };
        if (post.spaceId !== params.spaceId) return { success: false };

        const canEdit = user.role === "ADMIN" || user.id === post.space.userId;
        if (!canEdit) return { success: false };

        const currentStyle = parseSpaceAiStyle(post.aiStyle);

        await db.memoryPost.update({
            where: { id: postId },
            data: {
                aiStyle: { ...currentStyle, x, y } // 좌표 업데이트
            }
        });
        return { success: true };
    }

    // ✨ 2. 비밀번호 확인 로직 (기존 유지)
    const inputPassword = formData.get("password") as string;
    const space = await db.memorySpace.findUnique({ where: { id: params.spaceId } });

    if (!space) return { error: "방이 존재하지 않습니다.", posts: null };

    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
    const kstGap = 9 * 60 * 60 * 1000; // 9시간
    const kstNow = new Date(utc + kstGap);
    if (kstNow < new Date(space.targetDate)) {
        return { error: "아직 공개 날짜가 되지 않았습니다!", posts: null };
    }

    if (space.password === inputPassword) {
        const posts = await db.memoryPost.findMany({
            where: { spaceId: params.spaceId },
            orderBy: { createdAt: "desc" }
        });
        return { success: true, posts };
    }

    return { error: "비밀번호가 틀렸습니다.", posts: null };
}

// 📦 [Loader] 기존과 동일
export async function loader({ request, params }: LoaderFunctionArgs) {
    const { user } = await getSession(request);
    if (!params.spaceId) throw new Response("Not Found", { status: 404 });
    const space = await db.memorySpace.findUnique({ where: { id: params.spaceId } });
    if (!space) throw new Response("Not Found", { status: 404 });

    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
    const kstGap = 9 * 60 * 60 * 1000; // 9시간
    const kstNow = new Date(utc + kstGap);

    // 한국 시간 기준으로 날짜가 지났는지 판단
    const isDatePassed = kstNow >= new Date(space.targetDate);

    // 관리자(ADMIN) 체크 추가
    const isAdmin = user?.role === "ADMIN";
    const isOwner = user && user.id === space.userId;

    let initialPosts: SpacePost[] = [];
    if (isAdmin || (isDatePassed && isOwner)) {
        initialPosts = await db.memoryPost.findMany({
            where: { spaceId: params.spaceId },
            orderBy: { createdAt: "desc" }
        });
    }

    return { isAdmin, isOwner, isDatePassed, targetDate: space.targetDate, space, initialPosts };
}

export default function SpaceMain() {
    const { isAdmin, isOwner, isDatePassed, targetDate, space, initialPosts } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();

    const [view, setView] = useState<"GALAXY" | "ALBUM">("GALAXY");
    const [showLoginForm, setShowLoginForm] = useState(false);

    // ✨ [모두 펴기] 상태 관리
    const [globalCardState, setGlobalCardState] = useState<0 | 1 | 2>(0);
    const [isMobile, setIsMobile] = useState(false);
    const unlockedPosts: SpacePost[] | null = (isAdmin || (isDatePassed && isOwner))
        ? initialPosts
        : (actionData && "posts" in actionData && Array.isArray(actionData.posts) ? actionData.posts : null);
    useEffect(() => {
        if (typeof window !== "undefined") {
            const checkMobile = () => setIsMobile(window.innerWidth < 768);
            checkMobile();
            window.addEventListener("resize", checkMobile);
            return () => window.removeEventListener("resize", checkMobile);
        }
    }, []);
    const isLocked = !unlockedPosts;
    const canEdit = !!(isAdmin || (isDatePassed && isOwner));

    // 🔒 잠금 화면
    if (isLocked) {
        return (
            <div className="h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4 text-center relative overflow-hidden">
                <SpaceBackground />
                <div className="z-10 flex flex-col items-center max-w-sm w-full animate-fade-in">
                    <div className="text-6xl mb-6 animate-bounce">🎁</div>

                    <h1 className="text-2xl font-bold mb-2">
                        {isDatePassed
                            ? "비밀번호를 입력해주세요"
                            : "아직 열어볼 수 없어요!"}
                    </h1>

                    <p className="text-slate-400 mb-8">
                        {isDatePassed ? (
                            <span>주인공이라면 비밀번호를 입력하세요.</span>
                        ) : (
                            <span>
                                <span className="text-pink-400 font-bold">{new Date(targetDate).toLocaleDateString()}</span>에 공개됩니다.
                                <br />
                                {/* 주인공이 왔는데 날짜가 안 된 경우 */}
                                {isOwner && <span className="text-xs text-yellow-300 mt-1 block">(주인공님, 조금만 더 기다려주세요! 😉)</span>}
                            </span>
                        )}
                    </p>

                    {/* 입력창 표시 여부 */}
                    {!isDatePassed ? (
                        <div className="bg-white/5 border border-white/10 px-6 py-4 rounded-xl text-sm text-slate-300">
                            🚧 봉인 해제 대기 중 🚧
                        </div>
                    ) : (
                        !showLoginForm ? (
                            <button
                                onClick={() => setShowLoginForm(true)}
                                className="bg-white/10 border border-white/20 px-6 py-3 rounded-full text-sm font-bold hover:bg-white hover:text-black transition"
                            >
                                🔑 비밀번호 입력하기
                            </button>
                        ) : (
                            <div className="bg-slate-800/80 backdrop-blur-md p-6 rounded-2xl border border-slate-700 w-full shadow-2xl animate-pop-in-up">
                                <Form method="post" className="space-y-3">
                                    <input
                                        type="password"
                                        name="password"
                                        placeholder="비밀번호 4자리"
                                        className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-3 text-sm focus:border-pink-500 outline-none text-white placeholder-slate-500 text-center tracking-widest font-bold"
                                        autoFocus
                                        required
                                    />
                                    {actionData && 'error' in actionData && actionData.error && (
                                        <p className="text-red-400 text-xs font-bold bg-red-400/10 p-2 rounded">{actionData.error}</p>
                                    )}
                                    <button className="w-full bg-gradient-to-r from-indigo-500 to-pink-500 text-white font-bold py-3 rounded-lg hover:opacity-90 transition text-sm shadow-lg">
                                        확인 🔓
                                    </button>
                                </Form>
                                <button onClick={() => setShowLoginForm(false)} className="mt-4 text-xs text-slate-500 hover:text-white underline">취소</button>
                            </div>
                        )
                    )}
                </div>
            </div>
        );
    }

    // 🔓 잠금 해제됨
    const posts = unlockedPosts ?? [];
    const messages = posts.filter((post) => post.type === "MESSAGE");
    const photos = posts.filter((post) => post.type === "ALBUM");
    const toggleOpenAll = () => {
        // 현재 상태가 1(펴짐)이면 -> 2(접기)로 변경
        // 그 외엔 -> 1(펴기)로 변경
        if (globalCardState === 1) {
            setGlobalCardState(2);
        } else {
            setGlobalCardState(1);
        }


    };
    return (
        <div className="min-h-screen bg-[#050510] text-white relative overflow-hidden">
            {view === "GALAXY" ? <SpaceBackground /> : <AlbumBackground />}
            <div className="fixed inset-0 bg-white z-[60] animate-fade-out pointer-events-none" />
            <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_bottom,_var(--tw-gradient-stops))] from-[#1B1B3A] via-[#0B0B19] to-[#050510] pointer-events-none z-0"></div>

            <div className="absolute top-0 left-0 w-full z-40 flex justify-between px-6 py-6 items-center pointer-events-none">
                <div className="pointer-events-auto">
                    <h1 className="font-bold text-xl md:basedrop-shadow-md bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                        {space.title}
                    </h1>
                    {isOwner && isDatePassed && <span className="text-[10px] text-pink-400 font-bold block">다시 오신 걸 환영해요! 👑</span>}
                </div>

                <div className="flex gap-2 pointer-events-auto">
                    {/* [모두 펴기/접기] 버튼 - 모바일에서도 보임! */}
                    {view === "GALAXY" && (
                        <button
                            onClick={toggleOpenAll}
                            className={`
        text-xs px-3 py-1.5 rounded-full font-bold shadow-lg flex items-center gap-1 transition
        ${globalCardState === 1
                                    ? "bg-slate-700 hover:bg-slate-600 text-white"
                                    : "bg-indigo-600/80 hover:bg-indigo-500 text-white"
                                }
    `}
                        >
                            {globalCardState === 1 ? (
                                <>
                                    <FolderClosed size={14} />
                                    {/* 접기 버튼도 안전하게 CSS 처리 */}

                                    <span className="hidden md:inline">모두 접기</span>
                                </>
                            ) : (
                                <>
                                    <FolderOpen size={14} />
                                    {/* 🚨 여기가 에러 났던 부분! CSS로 수정 */}

                                    <span className="hidden md:inline">모두 펴기</span>
                                </>
                            )}
                        </button>
                    )}

                    <div className="bg-white/10 backdrop-blur-md border border-white/10 rounded-full p-1 flex gap-1 shadow-lg">
                        <button onClick={() => setView("GALAXY")} className={`px-4 py-1.5 rounded-full text-sm transition-all ${view === "GALAXY" ? "bg-white text-black font-bold shadow-sm" : "text-white/70 hover:text-white"}`}>🌌</button>
                        <button onClick={() => setView("ALBUM")} className={`px-4 py-1.5 rounded-full text-sm transition-all ${view === "ALBUM" ? "bg-white text-black font-bold shadow-sm" : "text-white/70 hover:text-white"}`}>📸</button>
                    </div>
                </div>
            </div>

            {/* 🌌 메인 뷰 영역 */}
            {view === "GALAXY" && (
                <div className="absolute inset-0 flex items-center justify-center overflow-hidden">

                    {/* ✨ [모바일 리스트 모드] : 모바일이고 + 모두 펴기 상태일 때 */}
                    {isMobile && globalCardState === 1 ? (
                        <div className="absolute inset-0 z-30 overflow-y-auto pt-24 pb-20 px-4 space-y-4 animate-fade-in scrollbar-hide">
                            {messages.map((msg, i) => (
                                <MobileMessageCard key={msg.id} post={msg} />
                            ))}
                            <div className="h-20" /> {/* 하단 여백 */}
                        </div>
                    ) : (
                        /* ✨ [기존 별 지도 모드] */
                        <div className="relative w-full h-full">
                            <div className="absolute top-1/2 left-1/2 w-0 h-0 z-10">
                                {messages.map((msg, i) => (
                                    <GalaxyMessageCard
                                        key={msg.id}
                                        post={msg}
                                        index={i}
                                        canEdit={canEdit}
                                        globalState={globalCardState}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {view === "ALBUM" && (
                <div className="absolute inset-0 overflow-y-auto scrollbar-hide pt-24 pb-20">
                    <SpaceAlbum title={space.title} posts={photos} />
                </div>
            )}
        </div>
    );
}

function MobileMessageCard({ post }: { post: SpacePost }) {
    const aiData = parseSpaceAiStyle(post.aiStyle);

    // 테마 색상 추출 (기존 로직 재사용하거나 단순화)
    let themeColor = "border-yellow-200 bg-yellow-50/10";
    if (aiData.theme?.includes("pink")) themeColor = "border-pink-300 bg-pink-50/10";
    if (aiData.theme?.includes("blue")) themeColor = "border-cyan-300 bg-cyan-50/10";
    if (aiData.theme?.includes("purple")) themeColor = "border-purple-300 bg-purple-50/10";

    return (
        <div className={`w-full bg-slate-900/80 backdrop-blur-md border ${themeColor} rounded-xl p-5 shadow-lg animate-pop-in-up`}>
            <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
                <span className="text-xs text-white/50 uppercase">보낸 사람</span>
                <span className="font-bold text-white text-sm">{post.nickname}</span>
            </div>
            {post.mediaUrl && (
                <div className="h-40 w-full overflow-hidden rounded-lg mb-3">
                    <img src={post.mediaUrl} className="w-full h-full object-cover" alt="첨부 이미지" />
                </div>
            )}
            <p className="text-white/90 whitespace-pre-wrap text-sm leading-relaxed">
                {post.content}
            </p>
        </div>
    );
}
