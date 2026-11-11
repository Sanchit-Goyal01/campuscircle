"use client";

import { useState } from "react";

type Question = { question: string; options: string[]; answer_index: number; page: number };
type Result =
  | { mode: "ask"; answer: string; pages: number[] }
  | { mode: "summary"; summary: string; pages: number[] }
  | { mode: "quiz"; questions: Question[] };

const GENERIC = "Study help is not available right now. Try again.";
const field = "border border-zinc-400 px-2 py-1";
const button = "border border-zinc-800 px-3 py-1 text-sm";

const pageHref = (noteId: string, page: number) => `/api/academics/files/notes/${noteId}#page=${page}`;

function Pages({ noteId, pages }: { noteId: string; pages: number[] }) {
  if (pages.length === 0) return null;
  return (
    <p className="text-sm">
      Sources:{" "}
      {pages.map((p) => (
        <a key={p} href={pageHref(noteId, p)} target="_blank" rel="noreferrer" className="mr-2 underline">
          Page {p}
        </a>
      ))}
    </p>
  );
}

function Quiz({ noteId, questions }: { noteId: string; questions: Question[] }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const score = questions.filter((q, i) => picked[i] === q.answer_index).length;
  return (
    <div className="flex flex-col gap-4">
      {questions.map((q, i) => (
        <fieldset key={i} className="flex flex-col gap-1">
          <legend className="font-medium">
            {i + 1}. {q.question}
          </legend>
          {q.options.map((o, j) => (
            <label key={j} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`q${i}`}
                disabled={checked}
                checked={picked[i] === j}
                onChange={() => setPicked((p) => ({ ...p, [i]: j }))}
              />
              {o}
            </label>
          ))}
          {checked && (
            <p className="text-sm">
              {picked[i] === q.answer_index ? "Correct." : `Not quite. The answer is: ${q.options[q.answer_index]}.`}{" "}
              <a href={pageHref(noteId, q.page)} target="_blank" rel="noreferrer" className="underline">
                Page {q.page}
              </a>
            </p>
          )}
        </fieldset>
      ))}
      {checked ? (
        <p role="status" className="font-medium">
          Score: {score} / {questions.length}
        </p>
      ) : (
        <button
          type="button"
          className={`self-start ${button}`}
          disabled={Object.keys(picked).length < questions.length}
          onClick={() => setChecked(true)}
        >
          Check answers
        </button>
      )}
    </div>
  );
}

export function StudyHelp({ noteId }: { noteId: string }) {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // A new quiz must start unanswered, so the quiz is remounted per response.
  const [version, setVersion] = useState(0);

  async function request(payload: { mode: "ask"; question: string } | { mode: "summary" | "quiz" }) {
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/academics/notes/${noteId}/help`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as (Partial<Result> & { error?: string }) | null;
      if (!res.ok || !data?.mode) {
        setError(data?.error ?? GENERIC);
        return;
      }
      setResult(data as Result);
      setVersion((v) => v + 1);
    } catch {
      setError(GENERIC);
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Study help" className="flex flex-col gap-3 border-t border-zinc-300 pt-4">
      <h2 className="font-slab text-xl font-bold">Study help</h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) void request({ mode: "ask", question: question.trim() });
        }}
      >
        <label className="flex flex-col text-sm">
          Your question
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={500}
            className={`w-80 ${field}`}
          />
        </label>
        <button type="submit" disabled={pending || !question.trim()} className={button}>
          Ask
        </button>
      </form>
      <div className="flex gap-3">
        <button type="button" disabled={pending} className={button} onClick={() => void request({ mode: "summary" })}>
          Summarise
        </button>
        <button type="button" disabled={pending} className={button} onClick={() => void request({ mode: "quiz" })}>
          Quiz me
        </button>
      </div>
      {pending && <p className="text-sm">Working on it...</p>}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {result && !pending && (
        <div aria-label="Study help result" className="flex flex-col gap-2">
          {result.mode === "ask" && <p className="whitespace-pre-wrap">{result.answer}</p>}
          {result.mode === "summary" && <p className="whitespace-pre-wrap">{result.summary}</p>}
          {result.mode !== "quiz" && <Pages noteId={noteId} pages={result.pages} />}
          {result.mode === "quiz" && <Quiz key={version} noteId={noteId} questions={result.questions} />}
        </div>
      )}
    </section>
  );
}
