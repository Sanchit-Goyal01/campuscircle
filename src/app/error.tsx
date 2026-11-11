"use client";

export default function AppError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p role="alert">We could not load your page. Please try again.</p>
      <div>
        <button type="button" onClick={() => retry()} className="rounded border border-zinc-400 px-3 py-1.5 text-sm">
          Try again
        </button>
      </div>
    </main>
  );
}
