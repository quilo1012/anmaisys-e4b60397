import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { signupQrPayload } from "@/lib/signupQr";

/**
 * The registration QR as an image, for the two screens that draw one.
 *
 * `inviteCode` is omitted on the login screen and given on the admin card — see
 * `signupQrPayload`, where the rule about which screens may pass one is written down
 * and why. It lives in its own file rather than beside either caller so that neither
 * owns it, and so a component file is not exporting a hook.
 *
 * `src` is null while it draws; `failed` says it will not arrive. They are separate
 * because a card that promises a code and shows a hole is worse than one that says
 * the address in words, and only the caller knows which of the two it should be.
 */
export function useSignupQr(base: string, inviteCode?: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    (async () => {
      try {
        const url = await QRCode.toDataURL(signupQrPayload(base, inviteCode), {
          errorCorrectionLevel: "M", margin: 1, width: 320,
        });
        if (alive) setSrc(url);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [base, inviteCode]);

  return { src, failed };
}
