import { Link } from "react-router-dom";

function LedgerVisual() {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <linearGradient id="heroWash" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0f4a34" />
          <stop offset="50%" stopColor="#1b6b4a" />
          <stop offset="100%" stopColor="#145a3c" />
        </linearGradient>
        <linearGradient id="pagePaper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7faf8" />
          <stop offset="100%" stopColor="#e8efe9" />
        </linearGradient>
        <pattern id="ledgerLines" width="1" height="28" patternUnits="userSpaceOnUse">
          <line x1="0" y1="27" x2="1" y2="27" stroke="#c5d6cb" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width="1440" height="900" fill="url(#heroWash)" />
      <ellipse className="animate-sheen" cx="1180" cy="100" rx="260" ry="150" fill="#2d9a6a" opacity="0.22" />
      <ellipse cx="200" cy="820" rx="300" ry="160" fill="#0a3324" opacity="0.35" />

      {/* Smaller ledger with margin from top/bottom so header buttons stay clear */}
      <g className="animate-drift" style={{ transformOrigin: "1120px 490px" }}>
        <rect x="880" y="200" width="460" height="520" rx="8" fill="url(#pagePaper)" />
        <rect x="880" y="200" width="26" height="520" fill="#d4e2d8" />
        <line x1="1110" y1="200" x2="1110" y2="720" stroke="#b8cfc0" strokeWidth="2" />

        <rect x="924" y="252" width="168" height="400" fill="url(#ledgerLines)" />
        <rect x="1132" y="252" width="180" height="400" fill="url(#ledgerLines)" />

        <text x="924" y="242" fill="#6b7f76" fontFamily="Source Sans 3, sans-serif" fontSize="12">
          Debit
        </text>
        <text x="1132" y="242" fill="#6b7f76" fontFamily="Source Sans 3, sans-serif" fontSize="12">
          Kredit
        </text>

        <text x="924" y="286" fill="#0f1f1a" fontFamily="Source Sans 3, sans-serif" fontSize="14" fontWeight="600">
          Kas
        </text>
        <text x="1080" y="286" fill="#1b6b4a" fontFamily="Source Sans 3, sans-serif" fontSize="14" textAnchor="end">
          25.000.000
        </text>
        <text x="1132" y="286" fill="#0f1f1a" fontFamily="Source Sans 3, sans-serif" fontSize="14" fontWeight="600">
          Modal disetor
        </text>
        <text x="1300" y="286" fill="#1b6b4a" fontFamily="Source Sans 3, sans-serif" fontSize="14" textAnchor="end">
          25.000.000
        </text>

        <text x="924" y="334" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14">
          Piutang usaha
        </text>
        <text x="1080" y="334" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14" textAnchor="end">
          4.200.000
        </text>
        <text x="1132" y="334" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14">
          Pendapatan
        </text>
        <text x="1300" y="334" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14" textAnchor="end">
          4.200.000
        </text>

        <text x="924" y="382" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14">
          Beban operasional
        </text>
        <text x="1080" y="382" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14" textAnchor="end">
          1.150.000
        </text>
        <text x="1132" y="382" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14">
          Kas
        </text>
        <text x="1300" y="382" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="14" textAnchor="end">
          1.150.000
        </text>

        <path
          className="animate-ink-draw"
          d="M924 440 H1080 M1132 440 H1300"
          stroke="#1b6b4a"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <text x="924" y="472" fill="#0f4a34" fontFamily="Fraunces, Georgia, serif" fontSize="16">
          Berimbang
        </text>
        <text x="1132" y="472" fill="#0f4a34" fontFamily="Fraunces, Georgia, serif" fontSize="16">
          Otomatis
        </text>
      </g>
    </svg>
  );
}

export function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Full-bleed visual */}
      <div className="absolute inset-0">
        <LedgerVisual />
        {/* Strong left scrim: readable copy zone; fades before the ledger */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, #0f4a34 0%, #0f4a34 38%, rgba(15,74,52,0.92) 52%, rgba(15,74,52,0.35) 68%, transparent 82%)",
          }}
        />
        {/* Mobile: full dark wash so copy never fights the ledger */}
        <div
          className="absolute inset-0 md:hidden"
          style={{
            background:
              "linear-gradient(180deg, #0f4a34 0%, #0f4a34 58%, rgba(15,74,52,0.88) 72%, rgba(15,74,52,0.45) 100%)",
          }}
        />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <div className="font-display text-2xl tracking-tight text-white">FinBiz</div>
          <div className="flex items-center gap-2 rounded-md bg-pine-dark/70 p-1 backdrop-blur-sm sm:gap-3 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
            <Link
              to="/login"
              className="rounded-md px-3 py-2 text-sm text-white transition hover:bg-white/10"
            >
              Masuk
            </Link>
            <Link
              to="/register"
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-pine-dark transition hover:bg-[#f0f6f2]"
            >
              Coba gratis
            </Link>
          </div>
        </header>

        <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 pb-24 pt-10 md:pb-28 md:pt-6">
          {/* Constrain copy to the dark scrim zone */}
          <div className="max-w-xl">
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
                className="rounded-md bg-white px-6 py-3 font-medium text-pine-dark transition hover:bg-[#f0f6f2]"
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
        </section>
      </div>
    </div>
  );
}
