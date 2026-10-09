import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserPlus, RefreshCw, Copy, Send, Clock, Printer } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSignupQr } from "@/hooks/useSignupQr";
import {
  EXPIRY_CHOICES, DEFAULT_EXPIRY, expiryFromChoice, expiryLabel, isExpired, type ExpiryChoice,
} from "@/lib/inviteExpiry";

/** Random, easy-to-read invite code (no ambiguous chars). */
function generateCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "AN-";
  const rnd = new Uint32Array(6);
  crypto.getRandomValues(rnd);
  for (let i = 0; i < 6; i++) out += alphabet[rnd[i] % alphabet.length];
  return out;
}

const cfg = () => supabase.from("signup_config");

/**
 * The same invite link as a picture, to print and pin up.
 *
 * The link above is for the people who are in a group chat. This is for the ones who
 * are not — the floor. A worker scanning the tablet's QR reaches the form with the
 * invite box empty and labelled "From your supervisor", and stops there; a sheet on
 * the wall by the clock is the supervisor, available at six in the morning.
 *
 * It is drawn here and nowhere public on purpose: `signup_config` is readable only
 * with an admin session, so this screen is one of the few that is allowed to hold the
 * code at all. The login page's QR carries none — see `signupQrPayload`.
 */
function InviteQr({ code }: { code: string }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const { src, failed } = useSignupQr(origin, code);
  if (failed || !origin) return null;

  /**
   * Built node by node rather than written as a string: the code is somebody's typing
   * and the sheet is a document, and the one place those two meet is the one place an
   * injection would live. `textContent` closes it by construction instead of by
   * remembering to escape.
   */
  const print = () => {
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w || !src) { toast.error("Allow pop-ups to print the sheet"); return; }
    const d = w.document;
    d.title = "Create your account";

    const style = d.createElement("style");
    style.textContent = `
      body{font-family:system-ui,sans-serif;margin:0;padding:48px;text-align:center;color:#0f172a}
      h1{font-size:34px;margin:0 0 8px}
      p.lead{font-size:17px;margin:0 0 28px;color:#475569}
      img{width:340px;height:340px}
      p.code{margin-top:28px;font-size:15px;color:#475569}
      p.code b{font-family:ui-monospace,monospace;font-size:21px;color:#0f172a;letter-spacing:.04em}
    `;
    d.head.appendChild(style);

    const h1 = d.createElement("h1");
    h1.textContent = "Create your account";
    const lead = d.createElement("p");
    lead.className = "lead";
    lead.textContent = "Scan this with your phone to sign up for overtime.";
    const img = d.createElement("img");
    img.src = src;
    img.alt = "";
    const fallback = d.createElement("p");
    fallback.className = "code";
    fallback.append("If scanning doesn't work, the invite code is ");
    const b = d.createElement("b");
    b.textContent = code;
    fallback.appendChild(b);

    d.body.append(h1, lead, img, fallback);
    w.focus();
    // After the picture is on the page, or the sheet prints with an empty square.
    if (img.complete) w.print();
    else img.onload = () => w.print();
  };

  return (
    <div className="mt-3 flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
      {src
        ? <img src={src} alt="QR code to sign-up with the invite code filled in" className="h-24 w-24 rounded bg-white p-1" />
        : <div className="h-24 w-24 animate-pulse rounded bg-muted" aria-hidden />}
      <div className="min-w-0 space-y-1.5">
        <p className="text-sm font-medium">Sheet for the wall</p>
        <p className="text-xs text-muted-foreground">
          Whoever scans this reaches sign-up with the code already filled in. Print it and put it
          where people clock in.
        </p>
        <Button type="button" variant="outline" size="sm" disabled={!src} onClick={print}>
          <Printer className="mr-1 h-4 w-4" /> Print the sheet
        </Button>
      </div>
    </div>
  );
}

/** Admin card: manage the self-registration invite code + on/off switch. */
export function SignupSettingsCard() {
  const [code, setCode] = useState("");
  const [enabled, setEnabled] = useState(false);
  // When the code stops working. Null is "never" — today's behaviour, kept for whoever
  // wants it; a freshly generated code proposes a week.
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  // What a self sign-up becomes. Null queues it for approval (today's behaviour);
  // "operator" makes it active on creation — enough to answer overtime, nothing more.
  const [autoRole, setAutoRole] = useState<"pending" | "operator">("pending");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let ok = true;
    cfg().select("invite_code, enabled, invite_expires_at, self_signup_role").eq("id", true).maybeSingle().then(({ data }: any) => {
      if (!ok || !data) { setLoading(false); return; }
      setCode(data.invite_code ?? "");
      setEnabled(!!data.enabled);
      setExpiresAt(data.invite_expires_at ?? null);
      setAutoRole(data.self_signup_role === "operator" ? "operator" : "pending");
      setLoading(false);
    });
    return () => { ok = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await cfg().update({
      invite_code: code.trim() || null, enabled, invite_expires_at: expiresAt,
      self_signup_role: autoRole === "operator" ? "operator" : null,
      updated_at: new Date().toISOString(),
    }).eq("id", true);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Sign-up settings saved");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><UserPlus className="h-4 w-4" /> Self sign-up</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm">Allow new users to register</Label>
                <p className="text-xs text-muted-foreground">When on, people can create an account with the invite code. What they become is set below.</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-code" className="text-sm">Invite code</Label>
              <div className="flex gap-2">
                <Input id="invite-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. AN-2026" autoComplete="off" className="font-mono" />
                <Button type="button" variant="outline" title="Generate a random code"
                  onClick={() => { setCode(generateCode()); setExpiresAt(expiryFromChoice(DEFAULT_EXPIRY)); }}>
                  <RefreshCw className="mr-1 h-4 w-4" /> Generate
                </Button>
                <Button type="button" variant="outline" size="icon" disabled={!code.trim()} title="Copy code"
                  onClick={() => { navigator.clipboard?.writeText(code.trim()); toast.success("Code copied"); }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Share this code with people you want to let register. Click <b>Generate</b> for a random one, then <b>Save</b>. Change it anytime to revoke access.</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Code stops working after</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Select onValueChange={(v) => setExpiresAt(expiryFromChoice(v as ExpiryChoice))}>
                  <SelectTrigger className="w-[160px]"><SelectValue placeholder="Set a limit…" /></SelectTrigger>
                  <SelectContent>
                    {EXPIRY_CHOICES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Badge variant="outline" className={cn("font-normal", isExpired(expiresAt) && "border-destructive/40 bg-destructive/10 text-destructive")}>
                  <Clock className="mr-1 h-3 w-3" />
                  {expiryLabel(expiresAt)}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                A code pasted into a group chat gets forwarded. Give it a week; generate a new one when somebody joins.
                {isExpired(expiresAt) && <> <b>This code has expired</b> — nobody can register with it until you pick a new limit and save.</>}
              </p>
            </div>

            {code.trim() && (() => {
              const origin = typeof window !== "undefined" ? window.location.origin : "";
              const link = `${origin}/signup?code=${encodeURIComponent(code.trim())}`;
              // The message is what gets pasted into the group, so it says what the person
              // is signing up for — otherwise the first question in the group is "what is this".
              const message = autoRole === "operator"
                ? `Overtime sign-up — create your account here: ${link}\nInvite code: ${code.trim()}\nAfter confirming your email, sign in, pick your name once, and you'll get a notification whenever overtime opens.`
                : `Create your ${document.title || "system"} account here: ${link}\nInvite code: ${code.trim()}`;
              return (
                <div className="space-y-1.5">
                  <Label className="text-sm">Invite link</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                    <Button type="button" variant="outline" size="icon" title="Copy link"
                      onClick={() => { navigator.clipboard?.writeText(link); toast.success("Invite link copied"); }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => { navigator.clipboard?.writeText(message); toast.success("Invite message copied — paste it to the person"); }}>
                    <Send className="mr-1 h-4 w-4" /> Copy link + code to send
                  </Button>
                  <p className="text-xs text-muted-foreground">The link opens sign-up with the code already filled in. Save the code first so the link works.</p>
                  <InviteQr code={code.trim()} />
                </div>
              );
            })()}

            <div className="space-y-1.5">
              <Label className="text-sm">New accounts start as</Label>
              <Select value={autoRole} onValueChange={(v) => setAutoRole(v as "pending" | "operator")}>
                <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending — you approve each one</SelectItem>
                  <SelectItem value="operator">Active operator — can answer overtime</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {autoRole === "operator"
                  ? <>Accounts from this link work straight away as <b>operator</b>: their own overtime asks and answers, nothing else. You still get a notification for each one and can deactivate them in Users.</>
                  : <>Accounts wait with no role until you set one in Users. Right for office logins; slow for a whole floor.</>}
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Save</Button>
            </div>
            {autoRole === "pending" && (
              <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                To approve a pending user: find them in the staff list (shown as <b>Inactive</b>, no role), edit them, set a role and mark <b>Active</b>.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
