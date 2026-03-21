import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { Star, ArrowsOutSimple } from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import { parseSpaceAiStyle, parseStoredPostIds, type SpacePost } from "~/lib/space-post";
// 전역 Z-Index (클릭/드래그 시 최상단 노출용)
let globalMaxZIndex = 100;

interface Props {
    post: SpacePost;
    index: number;
    canEdit: boolean;
    globalState: 0 | 1 | 2;
}

export default function GalaxyMessageCard({ post, index, canEdit, globalState }: Props) {
    const fetcher = useFetcher();

    // 상태 관리
    const [isOpen, setIsOpen] = useState(false); // 카드 열림 여부
    const [isHovered, setIsHovered] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [isRead, setIsRead] = useState(false);
    const [myZIndex, setMyZIndex] = useState(10);

    // ✨ 드래그 & 좌표 관련 상태
    const aiData = parseSpaceAiStyle(post.aiStyle);
    // 초기 위치 (DB 값 있으면 사용)
    const [position, setPosition] = useState({ x: aiData.x ?? 0, y: aiData.y ?? 0 });
    const [isDragging, setIsDragging] = useState(false);

    // 드래그 계산 Refs
    const dragStartPos = useRef({ x: 0, y: 0 });
    const itemStartPos = useRef({ x: 0, y: 0 });

    // 1. "모두 펴기" 신호 감지
    useEffect(() => {
        if (globalState === 1) {
            setIsOpen(true);
            bringToFront(); // 열릴 때 앞으로
        } else if (globalState === 2) {
            setIsOpen(false); // 닫기
        }
    }, [globalState]);

    // 2. 초기 위치 계산 (DB 값 없을 때만 랜덤 배치)
    useEffect(() => {
        const calculatePosition = () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            const mobile = w < 768;
            setIsMobile(mobile);

            // 안전 구역 (Safe Zone)
            const maxW = (w / 2) - (mobile ? 40 : 150);
            const maxH_Top = (h / 2) - (mobile ? 140 : 180);
            const maxH_Bottom = (h / 2) - (mobile ? 100 : 120);

            // 1. DB에 저장된 위치가 있는 경우
            if (typeof aiData.x === 'number' && typeof aiData.y === 'number') {
                let savedX = aiData.x;
                let savedY = aiData.y;

                // 🚨 [핵심] 모바일이면, 좌표를 안전 구역 안으로 강제 이동(Clamp)
                // PC에서 x=500에 뒀어도, 모바일 maxW가 150이면 150으로 바뀜.
                if (mobile) {
                    if (savedX > maxW) savedX = maxW;
                    if (savedX < -maxW) savedX = -maxW;

                    // Y축도 위아래 헤더 침범하지 않게 조정
                    if (savedY < -maxH_Top) savedY = -maxH_Top;
                    if (savedY > maxH_Bottom) savedY = maxH_Bottom;
                }

                setPosition({ x: savedX, y: savedY });
                return;
            }

            // 2. 저장된 위치가 없으면 랜덤 배치 (기존 로직)
            const seedX = Math.sin(index * 12.9898 + post.id) * 43758.5453;
            const randX = seedX - Math.floor(seedX);
            const seedY = Math.cos(index * 78.233 + post.id) * 43758.5453;
            const randY = seedY - Math.floor(seedY);

            const xRatio = (randX * 2) - 1;
            const yRatio = (randY * 2) - 1;

            const finalX = xRatio * maxW;
            let finalY = (yRatio < 0) ? yRatio * maxH_Top : yRatio * maxH_Bottom;

            setPosition({ x: finalX, y: finalY });
        };

        calculatePosition();

        // 화면 크기 바뀔 때마다 재계산 (저장된 좌표도 모바일 사이즈에 맞춰 다시 가둠)
        window.addEventListener("resize", calculatePosition);
        return () => window.removeEventListener("resize", calculatePosition);

    }, [post.id, index, aiData.x, aiData.y]);

    // 읽음 처리 (로컬 스토리지)
    useEffect(() => {
        const readList = parseStoredPostIds(localStorage.getItem("read_posts"));
        if (readList.includes(post.id)) setIsRead(true);
    }, [post.id]);

    // 🚀 [Z-Index 올리기] 함수
    const bringToFront = () => {
        globalMaxZIndex += 1;
        setMyZIndex(globalMaxZIndex);
    };

    // ✨ [드래그 이벤트] - 카드의 '헤더' 부분에서만 작동
    const handlePointerDown = (e: React.PointerEvent) => {
        if (!canEdit || !isOpen) return; // 수정 권한 없거나 닫혀있으면 드래그 불가

        e.preventDefault();
        e.stopPropagation();

        setIsDragging(true);
        bringToFront(); // 드래그 시작 시 맨 위로

        dragStartPos.current = { x: e.clientX, y: e.clientY };
        itemStartPos.current = { x: position.x, y: position.y };

        (e.target as Element).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging) return;
        e.preventDefault();
        e.stopPropagation();

        const deltaX = e.clientX - dragStartPos.current.x;
        const deltaY = e.clientY - dragStartPos.current.y;

        // 즉시 위치 업데이트 (부드러운 이동)
        setPosition({
            x: itemStartPos.current.x + deltaX,
            y: itemStartPos.current.y + deltaY
        });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!isDragging) return;
        e.preventDefault();
        e.stopPropagation();

        setIsDragging(false);
        (e.target as Element).releasePointerCapture(e.pointerId);

        // 드래그 종료 시 -> DB에 새 위치 저장!
        fetcher.submit(
            {
                intent: "move_post",
                postId: post.id,
                x: position.x,
                y: position.y
            },
            { method: "post" }
        );
    };

    // 별 클릭 핸들러 (카드 열기)
    const handleStarClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        bringToFront();

        if (!isRead) {
            setIsRead(true);
            const readList = parseStoredPostIds(localStorage.getItem("read_posts"));
            if (!readList.includes(post.id)) {
                localStorage.setItem("read_posts", JSON.stringify([...readList, post.id]));
            }
        }
        setIsOpen(true);
    };

    const handleClose = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsOpen(false);
        setIsHovered(false);
    };

    // 스타일
    const getThemeClass = (rawTheme?: string) => {
        if (!rawTheme) return "text-yellow-300 drop-shadow-[0_0_10px_rgba(253,224,71,0.6)]";
        const str = rawTheme.toLowerCase();
        if (str.includes("pink") || str.includes("red")) return "text-pink-400 drop-shadow-[0_0_10px_rgba(244,114,182,0.6)]";
        if (str.includes("blue") || str.includes("sky") || str.includes("cyan")) return "text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.6)]";
        if (str.includes("purple") || str.includes("violet")) return "text-purple-400 drop-shadow-[0_0_10px_rgba(192,132,252,0.6)]";
        if (str.includes("green") || str.includes("emerald")) return "text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.6)]";
        return "text-yellow-300 drop-shadow-[0_0_10px_rgba(253,224,71,0.6)]";
    };

    const baseThemeClass = getThemeClass(aiData.theme);
    const readStyle = isRead ? "!text-slate-500 !drop-shadow-none opacity-60" : "";
    const finalScale = (aiData.scale ?? (0.8 + (index % 5) * 0.3)) * (isMobile ? 0.7 : 1);
    const animDuration = (aiData.animDuration || (3 + (index % 4) + 's'));

    // 보여줄 상태: 마우스 호버 OR 열림 상태
    const showCard = isHovered || isOpen;
    const currentZIndex = showCard ? Math.max(myZIndex, 100) : (isRead ? 5 : 10);

    return (
        <div
            className="absolute flex justify-center items-center w-12 h-12 -ml-6 -mt-6"
            style={{
                left: "50%", top: "50%",
                transform: `translate(${position.x}px, ${position.y}px)`, // 위치는 항상 position 상태를 따름
                zIndex: isDragging ? 9999 : currentZIndex,
                transition: isDragging ? "none" : "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)", // 드래그 아닐 땐 부드럽게
            }}
            onMouseEnter={() => !isMobile && !isOpen && setIsHovered(true)}
            onMouseLeave={() => !isMobile && !isOpen && setIsHovered(false)}
        >
            {/* 1. ⭐ 별 아이콘 (카드가 닫혀있을 때만 보임) */}
            <div
                className={`
                    absolute flex justify-center items-center cursor-pointer
                    transition-all duration-300
                    ${(isOpen && !isMobile) ? "opacity-0 scale-0 pointer-events-none" : "opacity-100 scale-100"}
                `}
                onClick={handleStarClick} // 별 누르면 열림
                style={{
                    transform: (isOpen && !isMobile) ? `scale(0)` : `scale(${finalScale})`,
                    animation: (isOpen && !isMobile) ? 'none' : `star-float ${animDuration} infinite ease-in-out`
                }}
            >
                <Star
                    weight="fill"
                    className={`w-6 h-6 md:w-8 md:h-8 ${baseThemeClass} ${readStyle} transition-colors duration-300`}
                />
                <div className={`absolute inset-0 rounded-full blur-[8px] -z-10 ${isRead ? "bg-white/10" : "bg-white/40"}`}></div>
            </div>

            {/* 2. 💻 카드 (열렸을 때 보임) */}
            {!isMobile && (
                <div
                    // 카드를 클릭하면 일단 맨 앞으로 가져옴
                    onPointerDown={(e) => {
                        bringToFront();
                        e.stopPropagation();
                    }}
                    className={`
                        absolute w-80 
                        bg-slate-900/95 backdrop-blur-xl border rounded-2xl shadow-[0_0_60px_rgba(139,92,246,0.6)]
                        overflow-hidden transition-all duration-300
                        ${isOpen ? "border-pink-400/50 shadow-[0_0_80px_rgba(236,72,153,0.5)]" : "border-white/20"}
                        
                        /* 카드가 나타나는 애니메이션 */
                        ${isOpen
                            ? "opacity-100 scale-100 pointer-events-auto translate-y-0"
                            : "opacity-0 scale-0 pointer-events-none translate-y-5"
                        }
                    `}
                >
                    {/* 👆 카드 헤더 (드래그 핸들) */}
                    <div
                        className={`
                            px-4 py-3 border-b border-white/10 bg-white/5 flex justify-between items-center select-none
                            ${canEdit ? "cursor-move active:cursor-grabbing" : ""}
                        `}
                        // ✨ 여기서 드래그 이벤트 발생!
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                    >
                        <div className="flex flex-col text-left pointer-events-none">
                            <span className="text-[10px] text-white/50 uppercase tracking-widest">From</span>
                            <span className={`text-sm font-bold ${baseThemeClass.split(' ')[0]}`}>{post.nickname}</span>
                        </div>
                        <div className="flex gap-2">
                            {canEdit && <ArrowsOutSimple size={16} className="text-white/30" />} {/* 드래그 가능 표시 아이콘 */}
                            <button
                                onClick={handleClose}
                                className="text-white/40 hover:text-white transition-colors text-lg leading-none"
                                title="닫기"
                                // 닫기 버튼 누를 땐 드래그 안 되게 막기
                                onPointerDown={(e) => e.stopPropagation()}
                            >
                                ✖
                            </button>
                        </div>
                    </div>

                    {/* 카드 내용 (드래그 안 됨, 텍스트 선택 가능) */}
                    <div className="p-5 cursor-default">
                        {post.mediaUrl && (
                            <div className="h-40 overflow-hidden rounded-lg mb-4 relative group">
                                <img src={post.mediaUrl} alt="" className="w-full h-full object-cover" />
                            </div>
                        )}
                        <p className="text-white text-base font-medium whitespace-pre-wrap leading-relaxed drop-shadow-md break-keep">
                            "{post.content}"
                        </p>
                    </div>
                </div>
            )}

            {/* 3. 📱 모바일 팝업 (기존 유지 - 드래그 안 함) */}
            {isMobile && isOpen && (
                // createPortal을 사용해 이 팝업을 'document.body'로 순간이동시킵니다.
                // 그래야 'fixed'가 별 위치에 갇히지 않고 화면 전체를 덮습니다.
                typeof document !== "undefined"
                    ? createPortal(
                        <div
                            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in p-6"
                            onClick={handleClose}
                            // 터치 이벤트가 뒤로 새지 않게 막음
                            onTouchMove={(e) => e.stopPropagation()}
                        >
                            <div
                                onClick={(e) => e.stopPropagation()}
                                className="w-full max-w-sm bg-slate-900/90 backdrop-blur-xl border border-pink-400/50 rounded-2xl shadow-[0_0_50px_rgba(236,72,153,0.4)] overflow-hidden animate-pop-in-up"
                            >
                                {/* 모바일 팝업 헤더 */}
                                <div className="px-4 py-3 border-b border-white/10 bg-white/5 flex justify-between items-center">
                                    <div className="flex flex-col text-left">
                                        <span className="text-[10px] text-white/50 uppercase tracking-widest">From</span>
                                        <span className={`text-sm font-bold ${baseThemeClass.split(' ')[0]}`}>{post.nickname}</span>
                                    </div>
                                    <button onClick={handleClose} className="text-white/40 hover:text-white p-2">✖</button>
                                </div>

                                {/* 모바일 팝업 내용 */}
                                <div className="p-5 max-h-[70vh] overflow-y-auto">
                                    {post.mediaUrl && (
                                        <div className="h-48 w-full overflow-hidden rounded-lg mb-4 bg-black/50">
                                            <img src={post.mediaUrl} className="w-full h-full object-contain" alt="memory" />
                                        </div>
                                    )}
                                    <p className="text-white text-base font-medium whitespace-pre-wrap leading-relaxed">
                                        "{post.content}"
                                    </p>
                                </div>
                            </div>
                        </div>,
                        document.body
                    ) : null
            )}
        </div>
    );
}
