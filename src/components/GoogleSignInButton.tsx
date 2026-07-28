import { useEffect, useRef, useState } from "react";

const GIS_SRC = "https://accounts.google.com/gsi/client";
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            ux_mode?: "popup" | "redirect";
            auto_select?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              width?: number;
              text?: "signin_with" | "signup_with" | "continue_with";
              shape?: "rectangular" | "pill" | "circle" | "square";
              logo_alignment?: "left" | "center";
            },
          ) => void;
        };
      };
    };
  }
}

let gisLoadPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Gagal memuat Google")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Gagal memuat Google"));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

export function googleAuthEnabled(): boolean {
  return Boolean(CLIENT_ID && CLIENT_ID.trim());
}

type Props = {
  mode: "login" | "register";
  disabled?: boolean;
  onCredential: (idToken: string) => void | Promise<void>;
};

export function GoogleSignInButton({ mode, disabled, onCredential }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;

  useEffect(() => {
    if (!googleAuthEnabled() || !hostRef.current) return;
    let cancelled = false;

    loadGis()
      .then(() => {
        if (cancelled || !hostRef.current || !CLIENT_ID) return;
        window.google!.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => {
            void callbackRef.current(response.credential);
          },
          ux_mode: "popup",
          auto_select: false,
        });
        hostRef.current.innerHTML = "";
        const width = Math.min(hostRef.current.offsetWidth || 320, 400);
        window.google!.accounts.id.renderButton(hostRef.current, {
          theme: "outline",
          size: "large",
          width,
          text: mode === "register" ? "signup_with" : "signin_with",
          shape: "rectangular",
          logo_alignment: "left",
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [mode]);

  if (!googleAuthEnabled()) return null;

  return (
    <div className={disabled ? "pointer-events-none opacity-60" : undefined}>
      <div ref={hostRef} className="flex min-h-[44px] w-full justify-center" />
      {!ready && !failed && <p className="mt-2 text-center text-xs text-ink-faint">Memuat Google…</p>}
      {failed && <p className="mt-2 text-center text-xs text-ink-faint">Tombol Google tidak tersedia.</p>}
    </div>
  );
}
