export default function Loading() {
  return (
    <main className="min-h-screen bg-[#f7f4ee] px-4 py-6 text-[#151414]">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center justify-center">
        <div className="w-full max-w-md rounded-lg border border-[#ded8cc] bg-white p-6 shadow-sm">
          <div className="h-4 w-28 animate-pulse rounded bg-[#e8e1d5]" />
          <div className="mt-6 h-16 animate-pulse rounded bg-[#e8e1d5]" />
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="h-16 animate-pulse rounded bg-[#ece6da]" />
            <div className="h-16 animate-pulse rounded bg-[#ece6da]" />
            <div className="h-16 animate-pulse rounded bg-[#ece6da]" />
          </div>
        </div>
      </div>
    </main>
  );
}
