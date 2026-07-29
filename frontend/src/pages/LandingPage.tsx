import { Link } from "react-router-dom";

function LedgerVisual() {
  // Debit/credit columns stay symmetric around the center divider.
  const left = 56;
  const mid = 230;
  const gap = 14;
  const right = 404;
  const debitEnd = mid - gap;
  const creditStart = mid + gap;

  return (
    <svg
      className="h-full w-full"
      viewBox="0 0 460 520"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <defs>
        <linearGradient id="pagePaper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7faf8" />
          <stop offset="100%" stopColor="#e8efe9" />
        </linearGradient>
        <pattern id="ledgerLines" width="1" height="28" patternUnits="userSpaceOnUse">
          <line x1="0" y1="27" x2="1" y2="27" stroke="#c5d6cb" strokeWidth="1" />
        </pattern>
      </defs>

      <g className="animate-drift" style={{ transformOrigin: "230px 260px" }}>
        <rect x="0" y="0" width="460" height="520" rx="8" fill="url(#pagePaper)" />
        <rect x="0" y="0" width="26" height="520" fill="#d4e2d8" />
        <line x1={mid} y1="0" x2={mid} y2="520" stroke="#b8cfc0" strokeWidth="2" />

        <rect x={left} y="52" width={debitEnd - left} height="400" fill="url(#ledgerLines)" />
        <rect x={creditStart} y="52" width={right - creditStart} height="400" fill="url(#ledgerLines)" />

        <text x={left} y="42" fill="#6b7f76" fontFamily="Source Sans 3, sans-serif" fontSize="12">
          Debit
        </text>
        <text x={creditStart} y="42" fill="#6b7f76" fontFamily="Source Sans 3, sans-serif" fontSize="12">
          Kredit
        </text>

        <text x={left} y="86" fill="#0f1f1a" fontFamily="Source Sans 3, sans-serif" fontSize="14" fontWeight="600">
          Kas
        </text>
        <text x={debitEnd} y="86" fill="#1b6b4a" fontFamily="Source Sans 3, sans-serif" fontSize="14" textAnchor="end">
          25.000.000
        </text>
        <text x={creditStart} y="86" fill="#0f1f1a" fontFamily="Source Sans 3, sans-serif" fontSize="14" fontWeight="600">
          Modal disetor
        </text>
        <text x={right} y="86" fill="#1b6b4a" fontFamily="Source Sans 3, sans-serif" fontSize="14" textAnchor="end">
          25.000.000
        </text>

        <text x={left} y="134" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14">
          Piutang usaha
        </text>
        <text x={debitEnd} y="134" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14" textAnchor="end">
          4.200.000
        </text>
        <text x={creditStart} y="134" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14">
          Pendapatan
        </text>
        <text x={right} y="134" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14" textAnchor="end">
          4.200.000
        </text>

        <text x={left} y="182" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14">
          Beban operasional
        </text>
        <text x={debitEnd} y="182" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14" textAnchor="end">
          1.150.000
        </text>
        <text x={creditStart} y="182" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14">
          Kas
        </text>
        <text x={right} y="182" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14" textAnchor="end">
          1.150.000
        </text>

        <path
          className="animate-ink-draw"
          d={`M${left} 240 H${debitEnd} M${creditStart} 240 H${right}`}
          stroke="#1b6b4a"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <text x={left} y="272" fill="#0f4a34" fontFamily="Fraunces, Georgia, serif" fontSize="16">
          Berimbang
        </text>
        <text x={creditStart} y="272" fill="#0f4a34" fontFamily="Fraunces, Georgia, serif" fontSize="16">
          Otomatis
        </text>
      </g>
    </svg>
  );
}

export function LandingPage() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-brand-deep text-white">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 12% 0%, #1b6b4a 0%, transparent 55%), radial-gradient(ellipse 50% 40% at 100% 100%, #0a3324 0%, transparent 50%)",
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-svh w-full max-w-7xl flex-col px-6 lg:px-10">
        <header className="flex items-center justify-between py-5">
          <div className="font-display text-2xl tracking-tight text-white">FinBiz</div>
          <div className="flex items-center gap-2 rounded-md bg-brand-deep/70 p-1 backdrop-blur-sm sm:gap-3 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
            <Link
              to="/login"
              className="rounded-md px-3 py-2 text-sm text-white transition hover:bg-white/10"
            >
              Masuk
            </Link>
            <Link
              to="/register"
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-brand-deep transition hover:bg-[#f0f6f2]"
            >
              Coba gratis
            </Link>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-2 lg:gap-16 lg:py-6">
          <div className="max-w-xl lg:max-w-none">
            <p className="animate-fade-up font-display text-6xl leading-[0.95] tracking-tight text-white sm:text-7xl md:text-8xl">
              FinBiz
            </p>
            <h1 className="animate-fade-up-delay-1 mt-5 text-xl font-normal leading-snug text-white md:text-2xl">
              Pembukuan double-entry untuk banyak PT — kas, modal, hutang, piutang, laporan formal.
            </h1>
            <p className="animate-fade-up-delay-2 mt-4 text-base leading-relaxed text-white/85 md:text-lg">
              Form operasional yang ramah pemilik bisnis. Jurnal berimbang otomatis di belakang layar.
            </p>
            <div className="animate-fade-up-delay-3 mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="rounded-md bg-white px-6 py-3 font-medium text-brand-deep transition hover:bg-[#f0f6f2]"
              >
                Mulai trial 14 hari
              </Link>
              <Link
                to="/login"
                className="rounded-md border border-white/30 px-5 py-3 font-medium text-white transition hover:border-white/55 hover:bg-white/10"
              >
                Sudah punya akun?
              </Link>
            </div>
          </div>

          <div className="animate-fade-up-delay-2 relative mx-auto hidden w-full max-w-lg lg:block xl:max-w-xl">
            <div
              className="pointer-events-none absolute -inset-8 rounded-full opacity-40 blur-2xl"
              style={{ background: "radial-gradient(circle, #2d9a6a 0%, transparent 70%)" }}
            />
            <div className="relative aspect-[460/520] w-full overflow-hidden rounded-lg shadow-2xl shadow-black/25">
              <LedgerVisual />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
