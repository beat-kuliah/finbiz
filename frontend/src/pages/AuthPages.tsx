import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { GoogleSignInButton, googleAuthEnabled } from "@/components/GoogleSignInButton";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/store/auth";

function AuthLedger() {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 640 420"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <defs>
        <linearGradient id="authPagePaper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7faf8" />
          <stop offset="100%" stopColor="#e8efe9" />
        </linearGradient>
      </defs>
      <g className="animate-drift" style={{ transformOrigin: "320px 210px" }}>
        <rect x="72" y="24" width="496" height="372" rx="6" fill="url(#authPagePaper)" />
        <rect x="72" y="24" width="28" height="372" fill="#d4e2d8" />
        <line x1="320" y1="48" x2="320" y2="372" stroke="#b8cfc0" strokeWidth="1.5" />

        {[0, 1, 2, 3, 4, 5].map((i) => (
          <line
            key={i}
            x1="118"
            y1={92 + i * 40}
            x2="540"
            y2={92 + i * 40}
            stroke="#c5d6cb"
            strokeWidth="1"
          />
        ))}

        <text x="118" y="72" fill="#6b7f76" fontFamily="Source Sans 3, sans-serif" fontSize="12">
          Debit
        </text>
        <text x="340" y="72" fill="#6b7f76" fontFamily="Source Sans 3, sans-serif" fontSize="12">
          Kredit
        </text>

        <text x="118" y="118" fill="#0f1f1a" fontFamily="Source Sans 3, sans-serif" fontSize="13" fontWeight="600">
          Kas
        </text>
        <text x="300" y="118" fill="#1b6b4a" fontFamily="Source Sans 3, sans-serif" fontSize="13" textAnchor="end">
          25.000.000
        </text>
        <text x="340" y="118" fill="#0f1f1a" fontFamily="Source Sans 3, sans-serif" fontSize="13" fontWeight="600">
          Modal disetor
        </text>
        <text x="540" y="118" fill="#1b6b4a" fontFamily="Source Sans 3, sans-serif" fontSize="13" textAnchor="end">
          25.000.000
        </text>

        <text x="118" y="158" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="13">
          Piutang usaha
        </text>
        <text x="300" y="158" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="13" textAnchor="end">
          4.200.000
        </text>
        <text x="340" y="158" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="13">
          Pendapatan
        </text>
        <text x="540" y="158" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="13" textAnchor="end">
          4.200.000
        </text>

        <text x="118" y="198" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="13">
          Beban operasional
        </text>
        <text x="300" y="198" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="13" textAnchor="end">
          1.150.000
        </text>
        <text x="340" y="198" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="13">
          Kas
        </text>
        <text x="540" y="198" fill="#3d524a" fontFamily="Source Sans 3, sans-serif" fontSize="13" textAnchor="end">
          1.150.000
        </text>

        <path
          className="animate-ink-draw"
          d="M118 250 H300 M340 250 H540"
          stroke="#1b6b4a"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <text x="118" y="280" fill="#0f4a34" fontFamily="Fraunces, Georgia, serif" fontSize="16">
          Berimbang
        </text>
        <text x="340" y="280" fill="#0f4a34" fontFamily="Fraunces, Georgia, serif" fontSize="16">
          Otomatis
        </text>
      </g>
    </svg>
  );
}

function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-pine-dark text-white lg:flex lg:flex-col">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 45% at 10% 0%, #1b6b4a 0%, transparent 55%)",
          }}
        />

        <div className="relative z-10 px-12 pt-12">
          <Link to="/" className="font-display text-3xl tracking-tight text-white">
            FinBiz
          </Link>
          <p className="mt-3 max-w-sm text-base leading-relaxed text-white/80">
            Pembukuan formal tanpa ribet — satu akun untuk banyak bisnis.
          </p>
          <p className="mt-6 text-sm text-white/60">Trial 14 hari · Tanpa kartu kredit</p>
        </div>

        <div className="relative mt-auto h-[55%] min-h-[280px] px-6 pb-8">
          <AuthLedger />
        </div>
      </aside>

      <div className="relative flex min-h-screen flex-col justify-center bg-paper px-4 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-md">
          <Link to="/" className="mb-8 inline-block font-display text-3xl text-pine-dark lg:hidden">
            FinBiz
          </Link>

          <div className="animate-fade-up rounded-xl border border-sand bg-paper-card p-7 sm:p-8">
            <h1 className="font-display text-3xl text-pine-dark">{title}</h1>
            <p className="mt-1 mb-7 text-ink-muted">{subtitle}</p>
            {children}
            <p className="mt-5 text-center text-sm text-ink-muted">{footer}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-ink-faint">
      <div className="h-px flex-1 bg-sand" />
      <span>atau</span>
      <div className="h-px flex-1 bg-sand" />
    </div>
  );
}

export function LoginPage() {
  const { status, login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (status === "authenticated") return <Navigate to="/dashboard" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      toast.success("Berhasil masuk");
      navigate("/dashboard");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal masuk");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle(idToken: string) {
    setBusy(true);
    try {
      const { isNew } = await loginWithGoogle(idToken);
      toast.success(isNew ? "Akun Google dibuat — trial 14 hari aktif" : "Berhasil masuk");
      navigate(isNew ? "/onboarding" : "/dashboard");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal masuk dengan Google");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Masuk"
      subtitle="Selamat datang kembali ke FinBiz"
      footer={
        <>
          Belum punya akun?{" "}
          <Link className="font-medium text-pine hover:underline" to="/register">
            Daftar
          </Link>
        </>
      }
    >
      {googleAuthEnabled() && (
        <>
          <GoogleSignInButton mode="login" disabled={busy} onCredential={onGoogle} />
          <AuthDivider />
        </>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm text-ink-muted" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            className="auth-input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-ink-muted" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="auth-input"
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button disabled={busy} className="auth-btn mt-2">
          {busy ? "Memproses…" : "Masuk"}
        </button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { status, register, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (status === "authenticated") return <Navigate to="/onboarding" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await register(name, email, password);
      toast.success("Akun dibuat — trial 14 hari aktif");
      navigate("/onboarding");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal daftar");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle(idToken: string) {
    setBusy(true);
    try {
      const { isNew } = await loginWithGoogle(idToken);
      toast.success(isNew ? "Akun Google dibuat — trial 14 hari aktif" : "Berhasil masuk");
      navigate(isNew ? "/onboarding" : "/dashboard");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal daftar dengan Google");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Daftar"
      subtitle="Buat akun — trial gratis 14 hari"
      footer={
        <>
          Sudah punya akun?{" "}
          <Link className="font-medium text-pine hover:underline" to="/login">
            Masuk
          </Link>
        </>
      }
    >
      {googleAuthEnabled() && (
        <>
          <GoogleSignInButton mode="register" disabled={busy} onCredential={onGoogle} />
          <AuthDivider />
        </>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm text-ink-muted" htmlFor="reg-name">
            Nama
          </label>
          <input
            id="reg-name"
            className="auth-input"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-ink-muted" htmlFor="reg-email">
            Email
          </label>
          <input
            id="reg-email"
            className="auth-input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-ink-muted" htmlFor="reg-password">
            Password (min. 8)
          </label>
          <input
            id="reg-password"
            className="auth-input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button disabled={busy} className="auth-btn mt-2">
          {busy ? "Memproses…" : "Daftar"}
        </button>
      </form>
    </AuthShell>
  );
}
