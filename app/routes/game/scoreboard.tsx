import { type ActionFunctionArgs, type LoaderFunctionArgs, Link, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { LayoutGrid, Move, Pencil, Plus, RotateCcw, Settings, Trash2, Users, UserRound, Volume2, VolumeX, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { ClickableQr } from "~/components/game/clickable-qr";
import { colorFor, SCOREBOARD_LIMITS, SCOREBOARD_THEMES, themePalette } from "~/lib/scoreboard";
import * as sb from "~/lib/scoreboard.server";

const POLLING_INTERVAL = 8000; // SSE 백업용 (SSE 끊길 때만)

export const loader = async (_args: LoaderFunctionArgs) => {
  const board = await sb.getScoreboard();
  return { board };
};

export const action = ({ request }: ActionFunctionArgs) => sb.handleScoreboardAction(request);

function playBeep(up: boolean) {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = up ? 880 : 300;
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => ctx.close();
  } catch {
    /* 무음 무시 */
  }
}

type Team = ReturnType<typeof useLoaderData<typeof loader>>["board"]["teams"][number];

export default function ScoreboardPage() {
  const { board } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [origin, setOrigin] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const a1Ref = useRef<HTMLInputElement>(null);
  const a2Ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState<{ id: number; x: number; y: number; w: number; h: number; type: "move" | "resize" } | null>(null);
  const gesture = useRef<{ startX: number; startY: number; origX: number; origY: number; origW: number; origH: number; rect: DOMRect } | null>(null);

  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    if (editMode || drag || editing) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, POLLING_INTERVAL);
    return () => window.clearInterval(t);
  }, [revalidator, editMode, drag, editing]);

  // SSE: 조작 즉시 반영 (편집/드래그 중엔 무시)
  const suppressRef = useRef(false);
  useEffect(() => { suppressRef.current = editMode || drag != null || editing != null; }, [editMode, drag, editing]);
  useEffect(() => {
    const es = new EventSource("/game/scoreboard/stream");
    es.onmessage = () => { if (!suppressRef.current) revalidator.revalidate(); };
    return () => es.close();
  }, [revalidator]);

  const submit = (data: Record<string, string>) => fetcher.submit(data, { method: "post" });
  const a1 = board.amount1;
  const a2 = board.amount2;
  const busy = fetcher.state !== "idle";
  const reveal = board.mode !== "teams";
  const isEach = board.mode === "hostEach";
  const customTheme = board.theme.startsWith("#");
  const pal = themePalette(board.theme, board.cardColor); // 단색 배경 + 카드색(직접/파생)
  const [customColor, setCustomColor] = useState(customTheme ? board.theme : "#1e293b");
  const [customCardColor, setCustomCardColor] = useState(board.cardColor || "#334155");

  const teamSum = board.teams.reduce((s, t) => s + t.score, 0) + board.teamBonus; // 개별 합 + 공통 추가점수
  const maxScore = Math.max(...board.teams.map((t) => t.score), 0);
  const isLeader = (t: Team) => maxScore > 0 && t.score === maxScore;

  const adjustTeam = (t: Team, delta: number) => { if (board.soundOn) playBeep(delta > 0); submit({ intent: "adjust-team", teamId: String(t.id), delta: String(delta) }); };
  const adjustBonus = (delta: number) => { if (board.soundOn) playBeep(delta > 0); submit({ intent: "adjust-team-bonus", delta: String(delta) }); };
  // 사회자는 몰래 조정 — 효과음 없음
  const adjustHost = (delta: number) => { submit({ intent: "adjust-host", delta: String(delta) }); };

  // ---- 인라인 편집 ----
  const startEdit = (key: string, current: string) => setEditing({ key, value: current });
  const commitEdit = () => {
    if (!editing) return;
    const { key, value } = editing;
    const num = Number(value);
    const ok = value.trim() !== "" && !Number.isNaN(num);
    if (key.startsWith("team-name-")) submit({ intent: "rename-team", teamId: key.slice("team-name-".length), name: value });
    else if (key.startsWith("team-score-")) { if (ok) submit({ intent: "set-team", teamId: key.slice("team-score-".length), value }); }
    else if (key.startsWith("team-add-")) { if (ok) adjustTeam({ id: Number(key.slice("team-add-".length)) } as Team, num); }
    else if (key === "host-name") submit({ intent: "rename-host", name: value });
    else if (key === "host-score") { if (ok) submit({ intent: "set-host", value }); }
    else if (key === "host-add") { if (ok) adjustHost(num); }
    else if (key === "bonus-add") { if (ok) adjustBonus(num); }
    setEditing(null);
  };
  const editKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") commitEdit(); else if (e.key === "Escape") setEditing(null); };
  const inputCls = "w-full rounded bg-slate-900 px-2 py-1 text-center text-white outline-none ring-2 ring-yellow-400";

  // ---- 드래그/리사이즈 (2D) ----
  const onPointerDown = (e: ReactPointerEvent, t: Team, type: "move" | "resize") => {
    if (!editMode || !boardRef.current) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { startX: e.clientX, startY: e.clientY, origX: t.x, origY: t.y, origW: t.w, origH: t.h, rect: boardRef.current.getBoundingClientRect() };
    setDrag({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h, type });
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag || !gesture.current) return;
    const g = gesture.current;
    if (drag.type === "move") {
      const dx = ((e.clientX - g.startX) / g.rect.width) * 100;
      const dy = ((e.clientY - g.startY) / g.rect.height) * 100;
      setDrag({ ...drag, x: Math.min(95, Math.max(0, g.origX + dx)), y: Math.min(92, Math.max(0, g.origY + dy)) });
    } else {
      setDrag({
        ...drag,
        w: Math.min(SCOREBOARD_LIMITS.width.max, Math.max(SCOREBOARD_LIMITS.width.min, g.origW + (e.clientX - g.startX))),
        h: Math.min(SCOREBOARD_LIMITS.height.max, Math.max(SCOREBOARD_LIMITS.height.min, g.origH + (e.clientY - g.startY))),
      });
    }
  };
  const onPointerUp = () => {
    if (!drag) return;
    if (drag.type === "move") submit({ intent: "move-team", teamId: String(drag.id), x: String(Math.round(drag.x * 10) / 10), y: String(Math.round(drag.y * 10) / 10) });
    else submit({ intent: "resize-team", teamId: String(drag.id), w: String(Math.round(drag.w)), h: String(Math.round(drag.h)) });
    setDrag(null);
    gesture.current = null;
  };

  // ---- 렌더 헬퍼(함수: 컴포넌트 아님 → 인풋 포커스 유지) ----
  const nameEl = (t: Team, i: number, cls: string) =>
    editing?.key === `team-name-${t.id}` ? (
      <input autoFocus value={editing.value} onChange={(e) => setEditing({ key: editing.key, value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} maxLength={16} className={inputCls} />
    ) : (
      <button onClick={(e) => { e.stopPropagation(); startEdit(`team-name-${t.id}`, t.name); }} className={cls}>
        {isLeader(t) && "👑 "}{t.name}
      </button>
    );
  const scoreEl = (t: Team, cls: string) =>
    editing?.key === `team-score-${t.id}` ? (
      <input autoFocus type="number" value={editing.value} onChange={(e) => setEditing({ key: editing.key, value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} className={`${inputCls} ${cls}`} />
    ) : (
      <button onClick={(e) => { e.stopPropagation(); startEdit(`team-score-${t.id}`, String(t.score)); }} className={cls}>{t.score}</button>
    );
  const controlsEl = (t: Team) => (
    <div className="flex w-full shrink-0 flex-col gap-1">
      <div className="flex gap-1">
        {[-a2, -a1, a1, a2].map((delta, i) => (
          <Button key={i} onClick={(e) => { e.stopPropagation(); adjustTeam(t, delta); }} disabled={busy}
            className={`h-auto min-w-0 flex-1 px-0 py-1.5 text-xs font-bold text-white ${delta < 0 ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}`}>
            {delta > 0 ? `+${delta}` : delta}
          </Button>
        ))}
      </div>
      <div className="flex gap-1">
        {editing?.key === `team-add-${t.id}` ? (
          <input autoFocus type="number" placeholder="점수 입력 후 Enter" value={editing.value} onChange={(e) => setEditing({ key: editing.key, value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} className={`${inputCls} h-8 flex-1`} />
        ) : (
          <Button onClick={(e) => { e.stopPropagation(); startEdit(`team-add-${t.id}`, ""); }} title="직접 입력" className="h-8 flex-1 bg-slate-700 py-0 hover:bg-slate-600"><Pencil className="h-4 w-4" /></Button>
        )}
        <Button onClick={(e) => { e.stopPropagation(); if (confirm(`${t.name} 점수 초기화?`)) submit({ intent: "set-team", teamId: String(t.id), value: "0" }); }} title="점수 초기화" className="h-8 bg-slate-700 px-3 py-0 text-slate-300 hover:bg-red-900/40">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  // 팀 전체(팀합산) 카드 — 버튼은 공통 추가점수(teamBonus)에 가산
  const teamTotalCard = (fill: boolean, scoreCls: string) => (
    <div style={{ backgroundColor: pal.surface }} className={`flex flex-col items-center justify-center rounded-3xl border-b-4 border-black/30 p-6 shadow-[10px_12px_28px_rgba(0,0,0,0.55)] ${fill ? "h-full w-full" : "min-w-[240px]"}`}>
      <span className="text-2xl font-extrabold text-yellow-400">팀 전체</span>
      <span className={`${scoreCls} font-black text-white`}>{teamSum}</span>
      <div className="flex w-full max-w-xs flex-col gap-1">
        <div className="flex gap-1">
          {[-a2, -a1, a1, a2].map((delta, i) => (
            <Button key={i} onClick={() => adjustBonus(delta)} className={`min-w-0 flex-1 px-1 py-2 text-sm font-bold text-white ${delta < 0 ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}`}>{delta > 0 ? `+${delta}` : delta}</Button>
          ))}
        </div>
        {editing?.key === "bonus-add" ? (
          <input autoFocus type="number" placeholder="점수 입력 후 Enter" value={editing.value} onChange={(e) => setEditing({ key: "bonus-add", value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} className={inputCls} />
        ) : (
          <Button onClick={() => startEdit("bonus-add", "")} className="bg-slate-700 py-2 text-xs font-bold hover:bg-slate-600"><Pencil className="mr-1 h-3.5 w-3.5" /> 직접 입력</Button>
        )}
      </div>
    </div>
  );

  // 사회자 카드 (공개 화면용). fill=true → 컨테이너 가득, scoreCls로 점수 크기·간격
  const hostCard = (fill: boolean, scoreCls: string) => (
    <div style={{ backgroundColor: pal.surface }} className={`flex flex-col items-center justify-center rounded-3xl border-b-4 border-black/30 p-6 shadow-[10px_12px_28px_rgba(0,0,0,0.55)] ${fill ? "h-full w-full" : "min-w-[240px]"}`}>
      {editing?.key === "host-name" ? (
        <input autoFocus value={editing.value} onChange={(e) => setEditing({ key: "host-name", value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} maxLength={16} className={inputCls} />
      ) : (
        <button onClick={() => startEdit("host-name", board.hostName)} className="text-2xl font-extrabold text-white">{board.hostName}</button>
      )}
      {editing?.key === "host-score" ? (
        <input autoFocus type="number" value={editing.value} onChange={(e) => setEditing({ key: "host-score", value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} className={`${inputCls} ${scoreCls}`} />
      ) : (
        <button onClick={() => startEdit("host-score", String(board.hostScore))} className={`${scoreCls} font-black text-white`}>{board.hostScore}</button>
      )}
      <div className="flex w-full max-w-xs flex-col gap-1">
        <div className="flex gap-1">
          {[-a2, -a1, a1, a2].map((delta, i) => (
            <Button key={i} onClick={() => adjustHost(delta)} className={`min-w-0 flex-1 px-1 py-2 text-sm font-bold text-white ${delta < 0 ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}`}>{delta > 0 ? `+${delta}` : delta}</Button>
          ))}
        </div>
        {editing?.key === "host-add" ? (
          <input autoFocus type="number" placeholder="점수 입력 후 Enter" value={editing.value} onChange={(e) => setEditing({ key: "host-add", value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} className={inputCls} />
        ) : (
          <Button onClick={() => startEdit("host-add", "")} className="bg-slate-700 py-2 text-xs font-bold hover:bg-slate-600">직접 입력</Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen text-white" style={{ backgroundColor: pal.bg }}>
      {/* 상단 바 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3" style={{ backgroundColor: pal.header }}>
        <Link to="/game" className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold hover:bg-slate-700">
          <LayoutGrid className="h-4 w-4" /> 게임 목록
        </Link>
        {!reveal && (
          <>
            <button onClick={() => submit({ intent: "add-team" })} disabled={busy} className="flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold hover:bg-slate-700"><Plus className="h-4 w-4" /> 팀</button>
            <button onClick={() => submit({ intent: "set-sound", on: board.soundOn ? "false" : "true" })} className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold hover:bg-slate-700">{board.soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-slate-500" />} 효과음</button>
            <button onClick={() => setEditMode((v) => !v)} className={`hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-bold md:flex ${editMode ? "border-yellow-400 bg-yellow-400 text-black" : "border-slate-600 bg-slate-800 text-slate-300"}`}><Move className="h-4 w-4" /> 배치 편집</button>
            <button onClick={() => { if (confirm("모든 팀 점수를 0으로 초기화할까요?")) submit({ intent: "reset-scores" }); }} disabled={busy} className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold text-slate-300 hover:bg-red-900/30 hover:text-red-300"><RotateCcw className="h-4 w-4" /> 점수 초기화</button>
          </>
        )}
        {reveal && (
          <div className="flex overflow-hidden rounded-full border border-slate-600">
            <button onClick={() => submit({ intent: "set-mode", mode: "hostSum" })} className={`px-3 py-1.5 text-sm font-bold ${!isEach ? "bg-yellow-400 text-black" : "bg-slate-800 text-slate-300"}`}>합산</button>
            <button onClick={() => submit({ intent: "set-mode", mode: "hostEach" })} className={`px-3 py-1.5 text-sm font-bold ${isEach ? "bg-yellow-400 text-black" : "bg-slate-800 text-slate-300"}`}>개별</button>
          </div>
        )}
        {/* 사람 아이콘 = 사회자 공개/숨김 */}
        <button onClick={() => submit({ intent: "set-mode", mode: reveal ? "teams" : "hostSum" })} disabled={busy} title="사회자"
          className={`ml-auto flex h-9 w-9 items-center justify-center rounded-full ${reveal ? "bg-yellow-400 text-black" : "border border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
          <UserRound className="h-5 w-5" />
        </button>
        <button onClick={() => setPanelOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-600 bg-slate-800 hover:bg-slate-700"><Settings className="h-4 w-4" /></button>
      </div>

      {reveal ? (
        <div className="p-4">
          {!isEach ? (
            // 합산: 사회자 vs 팀 전체 (둘 다 절반, 버튼 포함)
            <div key="sum" className="flex items-center justify-center gap-4 duration-500 animate-in zoom-in fade-in" style={{ height: "calc(100vh - 92px)" }}>
              <div className="flex h-full w-1/2 max-w-2xl">{hostCard(true, "my-8 text-8xl md:text-9xl")}</div>
              <div className="shrink-0 text-4xl font-black text-slate-500">VS</div>
              <div className="flex h-full w-1/2 max-w-2xl">{teamTotalCard(true, "my-8 text-8xl md:text-9xl")}</div>
            </div>
          ) : (
            // 개별: 왼쪽 절반 사회자 / 오른쪽 절반 = 위 팀전체 + 아래 개별
            <div key="each" className="flex gap-4 duration-500 animate-in fade-in" style={{ height: "calc(100vh - 92px)" }}>
              <div className="flex w-1/2">{hostCard(true, "my-4 text-7xl")}</div>
              <div className="flex w-1/2 flex-col gap-4">
                <div className="flex h-1/2">{teamTotalCard(true, "my-2 text-6xl")}</div>
                <div className="flex h-1/2 flex-wrap content-start justify-center gap-3 overflow-auto">
                  {board.teams.map((t, i) => (
                    <div key={t.id} style={{ backgroundColor: pal.surface }} className="flex h-fit w-[200px] flex-col rounded-2xl shadow-[8px_10px_22px_rgba(0,0,0,0.5)]">
                      <div className="w-full border-b border-white/10 px-2 py-1 text-center">{nameEl(t, i, "text-base font-extrabold text-white")}</div>
                      <div className="flex items-center justify-center py-2">{scoreEl(t, "text-4xl font-black text-white")}</div>
                      <div className="p-2 pt-0">{controlsEl(t)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* 보드 (데스크톱) — 전체 화면 */}
          <div ref={boardRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="relative hidden w-full md:block" style={{ height: "calc(100vh - 60px)" }}>
            {board.teams.map((t, i) => {
              const live = drag && drag.id === t.id ? drag : null;
              const x = live ? live.x : t.x;
              const y = live ? live.y : t.y;
              const w = live ? live.w : t.w;
              const h = live ? live.h : t.h;
              return (
                <div key={t.id} style={{ left: `${x}%`, top: `${y}%`, width: `${w}px`, height: `${h}px`, backgroundColor: pal.surface }}
                  className={`absolute flex flex-col rounded-2xl shadow-[10px_12px_28px_rgba(0,0,0,0.55)] ${editMode ? "cursor-move select-none ring-2 ring-yellow-400/60" : ""}`}
                  onPointerDown={(e) => onPointerDown(e, t, "move")}>
                  {!editMode && (
                    <button onClick={(e) => { e.stopPropagation(); if (confirm(`${t.name} 삭제?`)) submit({ intent: "remove-team", teamId: String(t.id) }); }}
                      className="absolute right-1 top-1 z-10 rounded-full bg-black/30 p-1 text-white/70 hover:bg-red-600 hover:text-white" title="팀 삭제">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  <div className="w-full shrink-0 border-b border-white/10 px-2 py-2 text-center">{nameEl(t, i, "text-2xl font-extrabold text-white")}</div>
                  <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden leading-none">{scoreEl(t, "text-6xl font-black text-white")}</div>
                  {!editMode ? (
                    <div className="shrink-0 p-2 pt-0">{controlsEl(t)}</div>
                  ) : (
                    <div className="flex items-center justify-between p-2">
                      <button onClick={(e) => { e.stopPropagation(); if (confirm(`${t.name} 삭제?`)) submit({ intent: "remove-team", teamId: String(t.id) }); }} className="rounded p-1 text-red-400 hover:bg-red-900/30"><Trash2 className="h-5 w-5" /></button>
                      <div onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, t, "resize"); }} className="h-6 w-6 cursor-nwse-resize rounded-sm bg-slate-500" title="크기 조절" />
                    </div>
                  )}
                </div>
              );
            })}
            {editMode && <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-slate-700" />}
          </div>

          {/* 리스트 (모바일) */}
          <div className="flex flex-col gap-2 p-3 md:hidden">
            {board.teams.map((t, i) => (
              <div key={t.id} style={{ backgroundColor: pal.surface }} className="flex flex-col gap-2 rounded-xl border border-white/10 p-3 shadow-[6px_8px_16px_rgba(0,0,0,0.4)]">
                <div className="flex items-center gap-2">
                  <span className={`h-3 w-3 shrink-0 rounded-full ${colorFor(i)}`} />
                  <div className="flex-1">{nameEl(t, i, "w-full truncate text-left text-lg font-bold text-white")}</div>
                  <div className="w-20">{scoreEl(t, "text-4xl font-black text-white")}</div>
                  <button onClick={() => { if (confirm(`${t.name} 삭제?`)) submit({ intent: "remove-team", teamId: String(t.id) }); }} className="p-1 text-red-400"><Trash2 className="h-4 w-4" /></button>
                </div>
                {controlsEl(t)}
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1 text-slate-500"><Users className="h-4 w-4" /> {board.teams.length}개 팀</div>
          </div>
        </>
      )}

      {/* 진행자 패널 (설정·QR·사회자 몰래 조정) */}
      {panelOpen && (
        <div onClick={() => setPanelOpen(false)} className="fixed inset-0 z-[90] flex justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
          <div onClick={(e) => e.stopPropagation()} className="mt-6 h-fit w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">진행자 메뉴</h2>
              <button onClick={() => setPanelOpen(false)} className="text-slate-400 hover:text-white"><X className="h-6 w-6" /></button>
            </div>
            <div className="mb-4">
              <p className="mb-1 text-sm font-bold text-slate-300">배경 테마</p>
              <div className="grid grid-cols-3 gap-2">
                {SCOREBOARD_THEMES.map((th) => (
                  <button key={th.key} onClick={() => submit({ intent: "set-theme", theme: th.key })} className={`rounded-lg py-3 text-sm font-bold text-white ${th.bg} ${board.theme === th.key ? "ring-2 ring-yellow-400" : "border border-slate-600"}`}>{th.label}</button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-400">직접 색</span>
                <input type="color" value={customColor} onChange={(e) => setCustomColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-600 bg-transparent" />
                <Button onClick={() => submit({ intent: "set-theme", theme: customColor })} className={`px-4 ${customTheme ? "bg-yellow-400 text-black" : "bg-slate-700"}`}>이 색으로</Button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-400">카드 색</span>
                <input type="color" value={customCardColor} onChange={(e) => setCustomCardColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-600 bg-transparent" />
                <Button onClick={() => submit({ intent: "set-card-color", cardColor: customCardColor })} className={`px-4 ${board.cardColor ? "bg-yellow-400 text-black" : "bg-slate-700"}`}>적용</Button>
                <Button onClick={() => submit({ intent: "set-card-color", cardColor: "" })} className="bg-slate-700 px-3 text-xs">자동</Button>
              </div>
            </div>

            <div className="mb-4">
              <p className="mb-1 text-sm font-bold text-slate-300">카드 점수 단위</p>
              <div className="flex items-center gap-2">
                <input key={`a1-${a1}`} ref={a1Ref} type="number" defaultValue={a1} className="w-full rounded bg-slate-800 px-3 py-2 text-center text-white" />
                <input key={`a2-${a2}`} ref={a2Ref} type="number" defaultValue={a2} className="w-full rounded bg-slate-800 px-3 py-2 text-center text-white" />
                <Button onClick={() => submit({ intent: "set-amounts", amount1: a1Ref.current?.value ?? String(a1), amount2: a2Ref.current?.value ?? String(a2) })} className="bg-slate-700 px-4">저장</Button>
              </div>
            </div>
            <div className="mb-4 rounded-lg border border-slate-700 bg-slate-800/50 p-3">
              <p className="mb-2 text-sm font-bold text-slate-300">사회자 (몰래 조정)</p>
              <div className="mb-2 flex items-center gap-2">
                {editing?.key === "host-name" ? (
                  <input autoFocus value={editing.value} onChange={(e) => setEditing({ key: "host-name", value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} maxLength={16} className={`${inputCls} flex-1 text-left`} />
                ) : (
                  <button onClick={() => startEdit("host-name", board.hostName)} className="flex-1 text-left font-bold text-white">{board.hostName}</button>
                )}
                {editing?.key === "host-score" ? (
                  <input autoFocus type="number" value={editing.value} onChange={(e) => setEditing({ key: "host-score", value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} className={`${inputCls} w-20`} />
                ) : (
                  <button onClick={() => startEdit("host-score", String(board.hostScore))} className="text-2xl font-black text-white">{board.hostScore}</button>
                )}
              </div>
              <div className="flex gap-1">
                {[-a2, -a1, a1, a2].map((delta, i) => (
                  <Button key={i} onClick={() => adjustHost(delta)} className={`min-w-0 flex-1 px-1 py-2 text-xs font-bold text-white ${delta < 0 ? "bg-red-600" : "bg-green-600"}`}>{delta > 0 ? `+${delta}` : delta}</Button>
                ))}
              </div>
            </div>
            {origin && <div className="mb-4 flex justify-center"><ClickableQr value={`${origin}/game/scoreboard/control`} label="폰 조작 화면" size={120} /></div>}
            <div className="flex gap-2">
              <Button onClick={() => { if (confirm("모든 점수를 0으로?")) submit({ intent: "reset-scores" }); }} className="flex-1 bg-slate-700 py-3 font-bold text-slate-200 hover:bg-red-900/30"><RotateCcw className="mr-1 h-4 w-4" /> 전체 점수 0</Button>
              <Button onClick={() => { if (confirm("팀·사회자·점수를 모두 초기 상태(2팀)로?")) submit({ intent: "reset-all" }); }} variant="destructive" className="flex-1 py-3">전체 초기화</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
