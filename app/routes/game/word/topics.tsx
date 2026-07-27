import { type ActionFunctionArgs, type LoaderFunctionArgs, Form, Link, useLoaderData } from "react-router";
import { useState, type ReactNode } from "react";
import { LayoutGrid, Pencil, Plus, Save, Settings, Trash2, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { getTopics, handleWordAction } from "~/lib/word-game.server";

export const loader = async (_args: LoaderFunctionArgs) => {
  return { topics: await getTopics() };
};

export const action = ({ request }: ActionFunctionArgs) => handleWordAction(request);

const STAGE_LABELS = ["1단계", "2단계", "3단계", "4단계", "5단계"];

export default function WordTopicsPage() {
  const { topics } = useLoaderData<typeof loader>();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const stageInputs = (prefix: (i: number) => ReactNode) =>
    STAGE_LABELS.map((label, i) => (
      <div key={i} className="mb-2 flex items-center gap-2">
        <span className="w-12 shrink-0 text-sm text-slate-400">{label}</span>
        {prefix(i)}
      </div>
    ));

  return (
    <div className="min-h-screen bg-slate-900 p-4 pb-16 text-white">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-2">
          <Link to="/game" className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold hover:bg-slate-700"><LayoutGrid className="h-4 w-4" /> 게임 목록</Link>
          <Link to="/game/word/host" className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold hover:bg-slate-700"><Settings className="h-4 w-4" /> 진행 화면</Link>
          <h1 className="ml-auto text-xl font-bold text-slate-300">단어게임 주제 관리</h1>
        </div>

        <p className="mb-4 text-sm text-slate-500">1~4단계는 단어 1개, <span className="font-bold text-yellow-400">5단계는 여러 개</span>(쉼표 구분). 5단계는 진행 중 컨트롤러에서 골라 공개합니다.</p>

        {/* 새 주제 (추가 버튼 눌러야 열림) */}
        {adding ? (
          <Form method="post" onSubmit={() => setAdding(false)} className="mb-6 rounded-xl border border-slate-700 bg-slate-800 p-4">
            <input type="hidden" name="intent" value="create-topic" />
            <div className="mb-2 flex items-center justify-between">
              <p className="font-bold text-yellow-400">새 주제 추가</p>
              <button type="button" onClick={() => setAdding(false)} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <Input name="title" placeholder="주제 (예: 여름)" maxLength={30} className="mb-2 bg-slate-700 text-white" />
            {stageInputs((i) => (
              <Input name={`s${i + 1}`} placeholder={i === 4 ? "여러 개 가능 (쉼표로 구분)" : "단어 1개"} className="bg-slate-700 text-white" />
            ))}
            <Button type="submit" className="mt-1 w-full bg-yellow-400 py-3 font-bold text-black hover:bg-yellow-500"><Plus className="mr-1 h-4 w-4" /> 추가</Button>
          </Form>
        ) : (
          <Button onClick={() => setAdding(true)} className="mb-6 w-full bg-yellow-400 py-3 font-bold text-black hover:bg-yellow-500"><Plus className="mr-1 h-4 w-4" /> 새 주제 추가</Button>
        )}

        {/* 주제 목록 (1열) */}
        <div className="flex flex-col gap-2">
          {topics.length === 0 && <p className="text-center text-slate-500">아직 주제가 없습니다.</p>}
          {topics.map((topic) => (
            <div key={topic.id} className="rounded-xl border border-slate-700 bg-slate-800 p-3">
              {editingId === topic.id ? (
                <>
                  <Form method="post" onSubmit={() => setEditingId(null)}>
                    <input type="hidden" name="intent" value="update-topic" />
                    <input type="hidden" name="topicId" value={topic.id} />
                    <Input name="title" defaultValue={topic.title} maxLength={30} className="mb-2 bg-slate-700 font-bold text-white" />
                    {stageInputs((i) => (
                      <Input name={`s${i + 1}`} defaultValue={(topic.stages[i] ?? []).join(", ")} placeholder={i === 4 ? "여러 개 가능 (쉼표)" : "단어 1개"} className="bg-slate-700 text-white" />
                    ))}
                    <div className="mt-1 flex gap-2">
                      <Button type="submit" className="flex-1 bg-yellow-400 py-2 font-bold text-black hover:bg-yellow-500"><Save className="mr-1 h-4 w-4" /> 저장</Button>
                      <Button type="button" onClick={() => setEditingId(null)} className="bg-slate-600 px-4 py-2"><X className="h-4 w-4" /></Button>
                    </div>
                  </Form>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="truncate font-bold text-white">{topic.title}</span>
                  <span className="truncate text-xs text-slate-500">{topic.stages.map((arr, i) => (arr.length ? `${i + 1}.${arr.join("/")}` : "")).filter(Boolean).join("  ")}</span>
                  <div className="ml-auto flex shrink-0 gap-1">
                    <Button onClick={() => setEditingId(topic.id)} className="bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600"><Pencil className="mr-1 h-3.5 w-3.5" /> 수정</Button>
                    <Form method="post" onSubmit={(e) => { if (!confirm(`"${topic.title}" 삭제?`)) e.preventDefault(); }}>
                      <input type="hidden" name="intent" value="delete-topic" />
                      <input type="hidden" name="topicId" value={topic.id} />
                      <Button type="submit" variant="destructive" className="px-3 py-1.5 text-sm"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </Form>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
