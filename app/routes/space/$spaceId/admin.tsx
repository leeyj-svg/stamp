import { useState, useEffect } from "react";
import { Form, useActionData, useLoaderData, useNavigation, useFetcher, redirect } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { db } from "~/lib/db.server";
import { getSessionWithPermission } from "~/lib/auth.server";
import { generateAiMessages, optimizeLayout } from "~/lib/gemini.server";
import { Search, UserCheck, UserX, Trash2, Link as LinkIcon, RefreshCw, Wand2 } from "lucide-react";

type SearchUser = {
    id: string;
    name: string;
    phoneNumber: string;
};

type GeneratedMessage = Awaited<ReturnType<typeof generateAiMessages>>[number];
type OptimizedLayout = Awaited<ReturnType<typeof optimizeLayout>>[number];

// Loader: ?? ?? + ??? ??? ?? + ? ?? ????
export async function loader({ request, params }: LoaderFunctionArgs) {
    const { user } = await getSessionWithPermission(request, "ADMIN");
    if (!user) throw new Response("Unauthorized", { status: 401 });
    if (!params.spaceId) throw new Response("Not Found", { status: 404 });

    const space = await db.memorySpace.findUnique({
        where: { id: params.spaceId },
        include: {
            user: { select: { id: true, name: true, phoneNumber: true } } // ??? ??? ?? ????
        }
    });

    if (!space) throw new Response("Not Found", { status: 404 });

    const posts = await db.memoryPost.findMany({
        where: { spaceId: params.spaceId },
        orderBy: { createdAt: "desc" }
    });

    return { space, posts };
}

// Action: ?? ?? ??
export async function action({ request, params }: ActionFunctionArgs) {
    // ??? ?? ?? ??
    const { user } = await getSessionWithPermission(request, "ADMIN");
    if (!user) throw new Response("Unauthorized", { status: 401 });
    if (!params.spaceId) throw new Response("Not Found", { status: 404 });

    const formData = await request.formData();
    const intent = formData.get("intent");

    // 1. ??? ?? (fetcher)
    if (intent === "search_user") {
        const keyword = formData.get("keyword") as string;
        if (!keyword) return { error: "???? ??? ???." };

        const users = await db.user.findMany({
            where: {
                OR: [
                    { name: { contains: keyword } },
                    { phoneNumber: { contains: keyword } }
                ]
            },
            take: 5,
            select: { id: true, name: true, phoneNumber: true }
        });
        return { foundUsers: users };
    }

    // 2. ??? ?? / ??
    if (intent === "link_user") {
        const userId = formData.get("userId") as string;
        if (!userId) return { error: "??? ???? ??? ???." };

        const linkedUser = await db.user.findUnique({
            where: { id: userId },
            select: { id: true },
        });
        if (!linkedUser) return { error: "???? ?? ??????." };

        await db.memorySpace.update({
            where: { id: params.spaceId },
            data: { userId: userId } // ??
        });
        return { success: true, mode: "LINK" };
    }

    if (intent === "unlink_user") {
        await db.memorySpace.update({
            where: { id: params.spaceId },
            data: { userId: null } // ??
        });
        return { success: true, mode: "UNLINK" };
    }

    // 3. ?? ??
    if (intent === "delete_space") {
        // ??? ?? ?? ?????. Cascade ??? ?? ??? ?????.
        await db.$transaction([
            db.memoryPost.deleteMany({ where: { spaceId: params.spaceId } }),
            db.memorySpace.delete({ where: { id: params.spaceId } }),
        ]);

        return redirect("/space"); // ???? ??
    }

    // 4. ? ??
    if (intent === "delete_post") {
        const postId = Number(formData.get("postId"));
        if (Number.isNaN(postId)) return { error: "??? ??? ID???." };

        const post = await db.memoryPost.findUnique({
            where: { id: postId },
            select: { id: true, spaceId: true },
        });
        if (!post || post.spaceId !== params.spaceId) {
            return { error: "? ??? ?? ?? ????." };
        }

        await db.memoryPost.delete({ where: { id: postId } });
        return { success: true, mode: "DELETE_POST" };
    }

    // 5. ?? ?? ??
    if (intent === "update_space") {
        const title = formData.get("title") as string;
        const password = formData.get("password") as string;
        if (!title.trim()) return { error: "??? ?????." };

        await db.memorySpace.update({
            where: { id: params.spaceId },
            data: {
                title: title.trim(),
                password: password || undefined
            }
        });
        return { success: true, mode: "UPDATE" };
    }

    // 6. AI ?? ? ????
    if (intent === "GENERATE") {
        const topic = formData.get("topic") as string;
        const count = Number(formData.get("count"));
        const name = formData.get("name") as string;
        const age = formData.get("age") as string;
        const gender = formData.get("gender") as "male" | "female";

        const messages = await generateAiMessages(topic, count, { name, age, gender });

        await db.$transaction(messages.map((msg: GeneratedMessage) => db.memoryPost.create({
            data: {
                spaceId: params.spaceId!,
                type: "MESSAGE",
                content: msg.content,
                nickname: msg.nickname,
                aiStyle: msg.aiStyle,
                writerId: user.id
            }
        })));
        return { success: true, mode: "GENERATE" };
    }
    if (intent === "LAYOUT") {
        const posts = await db.memoryPost.findMany({ where: { spaceId: params.spaceId, type: "MESSAGE" } });
        if (posts.length === 0) return { error: "??? ?? ????." };

        const layouts = await optimizeLayout(posts.map(p => ({ id: p.id, content: p.content || "" })));

        await db.$transaction(layouts.map((layout: OptimizedLayout) => db.memoryPost.update({
            where: { id: Number(layout.id) },
            data: { aiStyle: layout.aiStyle }
        })));
        return { success: true, mode: "LAYOUT" };
    }
    return null;
}

export default function SpaceAdminPage() {
    const { space, posts } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";
    // ??? ??? Fetcher
    const userFetcher = useFetcher<typeof action>();

    // ?? ??
    const [copySuccess, setCopySuccess] = useState(false);
    const [origin, setOrigin] = useState("");

    // ??????? window ??? ??? ?? ??? ?????.
    useEffect(() => {
        setOrigin(window.location.origin);
    }, []);

    const foundUsers: SearchUser[] =
        userFetcher.data && "foundUsers" in userFetcher.data && Array.isArray(userFetcher.data.foundUsers)
            ? userFetcher.data.foundUsers
            : [];

    // ?? ?? ?? ???
    const handleCopyLink = () => {
        // window.location.origin ?? state? ??? origin ?? ?? ?????.
        const link = `${origin || window.location.origin}/space/${space.id}/write`;
        navigator.clipboard.writeText(link);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    };
    return (
        <div className="min-h-screen bg-slate-50 p-6 pb-32">
            <div className="max-w-6xl mx-auto space-y-8">

                {/* ?? */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                            ?? {space.title} <span className="text-slate-400 text-sm font-normal">??? ??</span>
                        </h1>
                        <p className="text-xs text-slate-500 mt-1">ID: {space.id}</p>
                    </div>
                    <div className="flex gap-2">
                        <a href={`/space/${space.id}`} target="_blank" rel="noreferrer" className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-50 flex items-center gap-1">
                            ?? ??
                        </a>
                        <a href="/space" className="bg-slate-800 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-700">
                            ????
                        </a>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                    {/* ??: ?? ?? */}
                    <div className="lg:col-span-1 space-y-6">

                        {/* 1. ??? ?? ?? */}
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
                            <h3 className="font-bold text-lg mb-3 text-slate-800 flex items-center gap-2">
                                ?? ???
                            </h3>

                            {space.user ? (
                                // ??? ??
                                <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 flex justify-between items-center">
                                    <div>
                                        <p className="font-bold text-indigo-700 text-sm">{space.user.name}</p>
                                        <p className="text-xs text-indigo-500">{space.user.phoneNumber}</p>
                                    </div>
                                    <Form method="post">
                                        <input type="hidden" name="intent" value="unlink_user" />
                                        <button className="text-xs text-slate-400 hover:text-red-500 underline" onClick={(e) => !confirm("??? ??? ??????") && e.preventDefault()}>
                                            ?? ??
                                        </button>
                                    </Form>
                                </div>
                            ) : (
                                // ???? ?? ?? -> ???
                                <div className="space-y-3">
                                    <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded">
                                        ?? ??? ???? ????.<br />???? ????? ?????.
                                    </div>
                                    <userFetcher.Form method="post" className="flex gap-2">
                                        <input type="hidden" name="intent" value="search_user" />
                                        <input name="keyword" placeholder="?? ?? ????" className="flex-1 border p-2 rounded text-xs" required />
                                        <button className="bg-slate-800 text-white p-2 rounded hover:bg-slate-700"><Search size={14} /></button>
                                    </userFetcher.Form>

                                    {/* ?? ?? */}
                                    {userFetcher.data && 'foundUsers' in userFetcher.data && (
                                        <div className="space-y-1 mt-2 max-h-40 overflow-y-auto">
                                            {foundUsers.map((u) => (
                                                <div key={u.id} className="flex justify-between items-center p-2 hover:bg-slate-50 rounded border border-transparent hover:border-slate-200">
                                                    <div>
                                                        <p className="text-xs font-bold">{u.name}</p>
                                                        <p className="text-[10px] text-slate-400">{u.phoneNumber}</p>
                                                    </div>
                                                    <Form method="post">
                                                        <input type="hidden" name="intent" value="link_user" />
                                                        <input type="hidden" name="userId" value={u.id} />
                                                        <button className="text-[10px] bg-indigo-500 text-white px-2 py-1 rounded hover:bg-indigo-600">??</button>
                                                    </Form>
                                                </div>
                                            ))}
                                            {foundUsers.length === 0 && <p className="text-xs text-slate-400 text-center">검색 결과 없음</p>}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 2. ?? ?? */}
                        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-5 rounded-2xl shadow-lg text-white">
                            <h3 className="font-bold text-sm mb-2 flex items-center gap-2"><LinkIcon size={16} /> ?? ??</h3>
                            <button onClick={handleCopyLink} className="w-full bg-white/20 hover:bg-white/30 p-3 rounded-xl text-xs text-left truncate transition">
                                {/* origin ???? ?????. */}
                                {copySuccess ? "???????!" : (origin ? `${origin}/space/${space.id}/write` : "?? ?? ?...")}
                            </button>
                        </div>

                        {/* 3. ?? ?? ?? */}
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
                            <h3 className="font-bold text-lg mb-4 text-slate-800">?? ?? ??</h3>
                            <Form method="post" className="space-y-4">
                                <input type="hidden" name="intent" value="update_space" />
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">?? ??</label>
                                    <input name="title" defaultValue={space.title} className="w-full border p-2 rounded text-sm" required />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">????</label>
                                    <input
                                        name="password"
                                        defaultValue={space.password || ""}
                                        placeholder="미설정"
                                        className="w-full border p-2 rounded text-sm"
                                    />
                                </div>
                                <button className="w-full bg-slate-800 text-white py-2 rounded-lg text-xs font-bold hover:bg-slate-700">
                                    저장
                                </button>
                            </Form>
                        </div>

                        {/* 4. ?? ?? */}
                        <div className="bg-red-50 p-5 rounded-2xl border border-red-100">
                            <h3 className="font-bold text-sm text-red-700 mb-2 flex items-center gap-2"><Trash2 size={16} /> ?? ??</h3>
                            <p className="text-xs text-red-500 mb-3">???? ??? ?? ???? ?? ?????.</p>
                            <Form method="post" onSubmit={(e) => !confirm("?? ? ??? ????????? ??? ? ????.") && e.preventDefault()}>
                                <input type="hidden" name="intent" value="delete_space" />
                                <button className="w-full bg-white border border-red-200 text-red-600 py-2 rounded-lg text-xs font-bold hover:bg-red-600 hover:text-white transition">
                                    ? ?? ??
                                </button>
                            </Form>
                        </div>
                    </div>

                    {/* ???: ??? ?? */}
                    <div className="lg:col-span-2 space-y-6">

                        {/* AI ? ???? ?? */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                <h4 className="font-bold text-sm mb-2 flex items-center gap-2 text-purple-600"><Wand2 size={16} /> AI ??? ??</h4>
                                <Form method="post" className="space-y-2">
                                    <input type="hidden" name="intent" value="GENERATE" />

                                    {/* ??/?? */}
                                    <div className="grid grid-cols-2 gap-2">
                                        <input name="name" placeholder="??" className="border p-1.5 rounded text-xs" required />
                                        <input name="age" placeholder="?? (?: 25)" className="border p-1.5 rounded text-xs" required />
                                    </div>

                                    {/* ??/?? */}
                                    <select name="gender" className="w-full border p-1.5 rounded text-xs">
                                        <option value="male">??</option>
                                        <option value="female">??</option>
                                    </select>
                                    <input name="topic" placeholder="?? (?: ??, ??)" className="w-full border p-1.5 rounded text-xs" required />

                                    {/* ??/?? */}
                                    <div className="flex gap-2">
                                        <select name="count" className="border p-1.5 rounded text-xs flex-1">
                                            <option value="5">5개</option>
                                            <option value="10">10개</option>
                                        </select>
                                        <button disabled={isSubmitting} className="bg-purple-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-purple-700 disabled:opacity-50">
                                            {isSubmitting ? "?? ?..." : "??"}
                                        </button>
                                    </div>
                                </Form>
                            </div>

                            {/* ???? ??? */}
                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
                                <div>
                                    <h4 className="font-bold text-sm mb-1 flex items-center gap-2 text-blue-600">
                                        <RefreshCw size={16} /> 별자리 재배치
                                    </h4>
                                    <p className="text-[10px] text-slate-400">????? ? ??? ?? ?????</p>
                                </div>
                                <Form method="post">
                                    <input type="hidden" name="intent" value="LAYOUT" />
                                    <button disabled={isSubmitting} className="w-full bg-blue-50 text-blue-600 py-2 rounded text-xs font-bold hover:bg-blue-100 disabled:opacity-50">
                                        ?? ?? ??
                                    </button>
                                </Form>
                            </div>
                        </div>

                        {/* ??? ?? */}
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 min-h-[500px]">
                            <h2 className="text-lg font-bold mb-4 border-b pb-2">??? ?? ({posts.length})</h2>
                            <div className="space-y-3">
                                {posts.map((post) => (
                                    <div key={post.id} className="flex items-start gap-3 p-3 border border-slate-100 rounded-lg hover:bg-slate-50 transition group">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${post.type === 'ALBUM' ? 'bg-pink-100 text-pink-600' : 'bg-indigo-100 text-indigo-600'}`}>
                                                    {post.type}
                                                </span>
                                                <span className="font-bold text-xs text-slate-700">{post.nickname}</span>
                                                <span className="text-[10px] text-slate-400">{new Date(post.createdAt).toLocaleDateString()}</span>
                                            </div>
                                            <p className="text-xs text-slate-600 line-clamp-1">{post.content}</p>
                                        </div>
                                        <Form method="post">
                                            <input type="hidden" name="intent" value="delete_post" />
                                            <input type="hidden" name="postId" value={post.id} />
                                            <button
                                                className="text-slate-300 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition"
                                                title="??"
                                                onClick={(e) => !confirm("? ???? ??????") && e.preventDefault()}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </Form>
                                    </div>
                                ))}
                                {posts.length === 0 && <p className="text-center text-slate-400 text-xs py-10">??? ???? ????.</p>}
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}

