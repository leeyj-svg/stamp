import { type ActionFunctionArgs, type LoaderFunctionArgs, Link, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useEffect, useRef, useState } from "react";
import { LayoutGrid, Monitor, Pencil, Plus, RotateCcw, Trash2, UserRound, Volume2, VolumeX } from "lucide-react";
import { Button } from "~/components/ui/button";
import { colorFor, themePalette } from "~/lib/scoreboard";
import * as sb from "~/lib/scoreboard.server";

const POLLING_INTERVAL = 8000; // SSE 백업용

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

export default function ScoreboardControlPage() {
  const { board } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const a1Ref = useRef<HTMLInputElement>(null);
  const a2Ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, POLLING_INTERVAL);
    return () => window.clearInterval(t);
  }, [revalidator, editing]);

  // SSE: 조작 즉시 반영
  const suppressRef = useRef(false);
  useEffect(() => { suppressRef.current = editing != null; }, [editing]);
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
  const teamSum = board.teams.reduce((s, t) => s + t.score, 0) + board.teamBonus;
  const pal = themePalette(board.theme, board.cardColor);

  const adjustTeam = (t: Team, delta: number) => { if (board.soundOn) playBeep(delta > 0); submit({ intent: "adjust-team", teamId: String(t.id), delta: String(delta) }); };
  const adjustBonus = (delta: number) => { if (board.soundOn) playBeep(delta > 0); submit({ intent: "adjust-team-bonus", delta: String(delta) }); };
  // 사회자는 몰래 조정 — 효과음 없음
  const adjustHost = (delta: number) => { submit({ intent: "adjust-host", delta: String(delta) }); };

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

  const amountButtons = (onDelta: (d: number) => void) => (
    <div className="flex gap-1">
      {[-a2, -a1, a1, a2].map((delta, i) => (
        <Button key={i} onClick={() => onDelta(delta)} disabled={busy} className={`h-9 min-w-0 flex-1 px-1 py-0 text-sm font-bold text-white ${delta < 0 ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}`}>
          {delta > 0 ? `+${delta}` : delta}
        </Button>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: pal.bg }}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 p-3">
        <Link to="/game" className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold hover:bg-slate-700"><LayoutGrid className="h-4 w-4" /> 목록</Link>
        <Link to="/game/scoreboard" className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold hover:bg-slate-700"><Monitor className="h-4 w-4" /> 큰 화면</Link>
        <button onClick={() => submit({ intent: "set-sound", on: board.soundOn ? "false" : "true" })} className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold hover:bg-slate-700">{board.soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-slate-500" />}</button>
        <button onClick={() => submit({ intent: "set-mode", mode: reveal ? "teams" : "hostSum" })} title="사회자 공개" className={`ml-auto flex h-9 w-9 items-center justify-center rounded-full ${reveal ? "bg-yellow-400 text-black" : "border border-slate-600 bg-slate-800 text-slate-300"}`}><UserRound className="h-5 w-5" /></button>
      </div>

      <div className="mx-auto flex max-w-md flex-col gap-3 p-3">
        {reveal && (
          <div className="flex overflow-hidden rounded-full border border-slate-600 text-center">
            <button onClick={() => submit({ intent: "set-mode", mode: "hostSum" })} className={`flex-1 py-2 text-sm font-bold ${!isEach ? "bg-yellow-400 text-black" : "bg-slate-800 text-slate-300"}`}>합산</button>
            <button onClick={() => submit({ intent: "set-mode", mode: "hostEach" })} className={`flex-1 py-2 text-sm font-bold ${isEach ? "bg-yellow-400 text-black" : "bg-slate-800 text-slate-300"}`}>개별</button>
          </div>
        )}

        {/* 사회자 (몰래 조정) */}
        <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
          <p className="mb-2 text-xs font-bold text-slate-400">사회자 (몰래 조정)</p>
          <div className="mb-2 flex items-center gap-2">
            {editing?.key === "host-name" ? (
              <input autoFocus value={editing.value} onChange={(e) => setEditing({ key: "host-name", value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} maxLength={16} className={`${inputCls} flex-1 text-left`} />
            ) : (
              <button onClick={() => startEdit("host-name", board.hostName)} className="flex-1 text-left font-bold text-white">{board.hostName}</button>
            )}
            {editing?.key === "host-score" ? (
              <input autoFocus type="number" value={editing.value} onChange={(e) => setEditing({ key: "host-score", value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} className={`${inputCls} w-20`} />
            ) : (
              <button onClick={() => startEdit("host-score", String(board.hostScore))} className="text-3xl font-black text-white">{board.hostScore}</button>
            )}
          </div>
          {amountButtons(adjustHost)}
          <div className="mt-1">
            {editing?.key === "host-add" ? (
              <input autoFocus type="number" placeholder="점수 입력 후 Enter" value={editing.value} onChange={(e) => setEditing({ key: "host-add", value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} className={inputCls} />
            ) : (
              <Button onClick={() => startEdit("host-add", "")} className="h-8 w-full bg-slate-700 py-0 text-xs hover:bg-slate-600"><Pencil className="mr-1 h-3.5 w-3.5" /> 직접 입력</Button>
            )}
          </div>
        </div>

        {/* 팀 전체(공통) 점수 */}
        <div className="rounded-xl border border-yellow-700/60 bg-slate-800/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-yellow-400">팀 전체 (공통 추가)</span>
            <span className="text-2xl font-black text-white">{teamSum}</span>
          </div>
          {amountButtons(adjustBonus)}
          <div className="mt-1">
            {editing?.key === "bonus-add" ? (
              <input autoFocus type="number" placeholder="점수 입력 후 Enter" value={editing.value} onChange={(e) => setEditing({ key: "bonus-add", value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} className={inputCls} />
            ) : (
              <Button onClick={() => startEdit("bonus-add", "")} className="h-8 w-full bg-slate-700 py-0 text-xs hover:bg-slate-600"><Pencil className="mr-1 h-3.5 w-3.5" /> 직접 입력</Button>
            )}
          </div>
        </div>

        {/* 점수 단위 */}
        <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/60 p-3">
          <span className="text-xs font-bold text-slate-400">단위</span>
          <input key={`a1-${a1}`} ref={a1Ref} type="number" defaultValue={a1} className="w-full rounded bg-slate-900 px-2 py-1.5 text-center text-white" />
          <input key={`a2-${a2}`} ref={a2Ref} type="number" defaultValue={a2} className="w-full rounded bg-slate-900 px-2 py-1.5 text-center text-white" />
          <Button onClick={() => submit({ intent: "set-amounts", amount1: a1Ref.current?.value ?? String(a1), amount2: a2Ref.current?.value ?? String(a2) })} className="bg-slate-700 px-3">저장</Button>
        </div>

        {/* 팀 목록 */}
        {board.teams.map((t, i) => (
          <div key={t.id} className="flex flex-col gap-2 rounded-xl border border-slate-700 bg-slate-800 p-3">
            <div className="flex items-center gap-2">
              <span className={`h-3 w-3 shrink-0 rounded-full ${colorFor(i)}`} />
              {editing?.key === `team-name-${t.id}` ? (
                <input autoFocus value={editing.value} onChange={(e) => setEditing({ key: editing.key, value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} maxLength={16} className={`${inputCls} flex-1 text-left`} />
              ) : (
                <button onClick={() => startEdit(`team-name-${t.id}`, t.name)} className="flex-1 truncate text-left text-lg font-bold text-white">{t.name}</button>
              )}
              {editing?.key === `team-score-${t.id}` ? (
                <input autoFocus type="number" value={editing.value} onChange={(e) => setEditing({ key: editing.key, value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} className={`${inputCls} w-20`} />
              ) : (
                <button onClick={() => startEdit(`team-score-${t.id}`, String(t.score))} className="text-3xl font-black text-white">{t.score}</button>
              )}
              <button onClick={() => { if (confirm(`${t.name} 삭제?`)) submit({ intent: "remove-team", teamId: String(t.id) }); }} className="p-1 text-red-400"><Trash2 className="h-4 w-4" /></button>
            </div>
            {amountButtons((d) => adjustTeam(t, d))}
            <div className="flex gap-1">
              {editing?.key === `team-add-${t.id}` ? (
                <input autoFocus type="number" placeholder="점수 입력 후 Enter" value={editing.value} onChange={(e) => setEditing({ key: editing.key, value: e.target.value })} onBlur={commitEdit} onKeyDown={editKeyDown} className={`${inputCls} h-8 flex-1`} />
              ) : (
                <Button onClick={() => startEdit(`team-add-${t.id}`, "")} className="h-8 flex-1 bg-slate-700 py-0 text-xs hover:bg-slate-600"><Pencil className="mr-1 h-3.5 w-3.5" /> 직접 입력</Button>
              )}
              <Button onClick={() => { if (confirm(`${t.name} 점수 초기화?`)) submit({ intent: "set-team", teamId: String(t.id), value: "0" }); }} className="h-8 bg-slate-700 px-3 py-0 text-slate-300 hover:bg-red-900/40"><RotateCcw className="h-4 w-4" /></Button>
            </div>
          </div>
        ))}

        <div className="flex gap-2">
          <Button onClick={() => submit({ intent: "add-team" })} disabled={busy} className="flex-1 bg-slate-700 py-3 font-bold hover:bg-slate-600"><Plus className="mr-1 h-4 w-4" /> 팀 추가</Button>
          <Button onClick={() => { if (confirm("모든 팀 점수를 0으로?")) submit({ intent: "reset-scores" }); }} className="flex-1 bg-slate-700 py-3 font-bold text-slate-200 hover:bg-red-900/30"><RotateCcw className="mr-1 h-4 w-4" /> 점수 초기화</Button>
        </div>
      </div>
    </div>
  );
}
