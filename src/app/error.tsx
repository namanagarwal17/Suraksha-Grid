"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <div className="p-8 text-center"><p className="font-semibold">Something went wrong.</p><button className="mt-3 rounded-xl bg-brand px-4 py-2 text-white" onClick={reset}>Try again</button></div>;
}
