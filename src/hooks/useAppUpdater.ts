import { useCallback, useEffect, useRef, useState } from "react";

/**
 * O que uma verificação pedida à mão encontrou.
 *
 *  - `updated`  — há build novo; a página vai recarregar.
 *  - `current`  — já está no mais recente. Vale a pena dizê-lo: sem resposta, quem carrega
 *                 no botão não sabe se funcionou e carrega outra vez.
 *  - `unknown`  — não deu para perguntar (sem rede, ou em dev, onde não há `/assets/`).
 */
export type UpdateCheck = "updated" | "current" | "unknown";

/**
 * Keeps the tablet on the latest deployed build without a manual refresh.
 * Vite emits a hashed `/assets/index-*.js` entry that changes on every publish,
 * so we compare the currently-running entry against the one in the freshly
 * fetched index.html. When a new build is out:
 *   - if the app is backgrounded → reload right away (zero interruption);
 *   - if it's in use → expose `updateReady` so the UI can show a prominent
 *     "Update now" banner, and still auto-reload the next time the app is
 *     backgrounded, so we never wipe a half-typed entry or leave the tablet
 *     stuck on a stale build.
 *
 * Returns `{ updateReady, reloadNow, checkNow, checking }` for the banner in
 * <AppBanners/> and para o botão de "Check for updates".
 *
 * `checkNow` existe porque a deteção automática tem um ritmo: 15 s depois de abrir, depois
 * de 2 em 2 minutos, e sempre que a app volta ao primeiro plano. Para quem acabou de
 * publicar e quer ver a mudança agora, dois minutos é tempo a mais — e sem forma de
 * forçar, a saída era fechar a app e voltar a abrir. É pedir a mesma pergunta já, à
 * ordem, e dizer a resposta mesmo quando é "já estás no mais recente".
 */
export function useAppUpdater() {
  const baselineRef = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const fetchRef = useRef<(() => Promise<string | null>) | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [checking, setChecking] = useState(false);

  const reloadNow = useCallback(() => { location.reload(); }, []);

  /**
   * A verificação pedida à mão. Recarrega sozinha quando encontra build novo — quem
   * carregou no botão pediu exactamente isso, e um segundo passo ("encontrei, queres
   * recarregar?") só põe outro toque entre a pessoa e a versão nova.
   */
  const checkNow = useCallback(async (): Promise<UpdateCheck> => {
    const ask = fetchRef.current;
    if (!ask || !baselineRef.current) return "unknown";
    setChecking(true);
    try {
      const latest = await ask();
      if (!latest) return "unknown";
      if (latest === baselineRef.current) return "current";
      location.reload();
      return "updated";
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const currentEntry = (): string | null => {
      const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'));
      const asset = scripts.map((s) => s.src).find((s) => /\/assets\/.*\.js/.test(s));
      return asset ? new URL(asset, location.href).pathname : null;
    };
    baselineRef.current = currentEntry();
    // Only meaningful for a production build (dev has no /assets/ entry).
    if (!baselineRef.current) return;

    let stopped = false;

    const fetchLatestEntry = async (): Promise<string | null> => {
      try {
        const res = await fetch(`/index.html?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return null;
        const html = await res.text();
        const m =
          html.match(/<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+\.js)"/i) ??
          html.match(/src="([^"]*\/assets\/index[^"]+\.js)"/i);
        return m ? new URL(m[1], location.href).pathname : null;
      } catch {
        return null;
      }
    };

    // O botão usa a mesma pergunta que o temporizador, e não uma cópia dela.
    fetchRef.current = fetchLatestEntry;

    const onUpdateDetected = () => {
      if (pendingRef.current) return;
      // Backgrounded → reload straight away, no interruption.
      if (document.visibilityState === "hidden") { location.reload(); return; }
      // In use → surface the banner and remember to reload once idle.
      pendingRef.current = true;
      setUpdateReady(true);
    };

    const check = async () => {
      if (stopped || !baselineRef.current) return;
      const latest = await fetchLatestEntry();
      if (latest && latest !== baselineRef.current) onUpdateDetected();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (pendingRef.current) location.reload();
      } else {
        check();
      }
    };

    const interval = window.setInterval(check, 2 * 60 * 1000);
    const first = window.setTimeout(check, 15_000);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      fetchRef.current = null;
      window.clearInterval(interval);
      window.clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { updateReady, reloadNow, checkNow, checking };
}
