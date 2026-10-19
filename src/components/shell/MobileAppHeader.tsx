import { useEffect, useState } from "react";
import { BellRing, LogOut, Menu, Moon, PowerOff, Sun, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BackButton } from "@/components/BackButton";
import { useSidebar } from "@/components/ui/sidebar";
import { NotificationPanel } from "@/components/NotificationPanel";
import { AudioStatusButton } from "@/components/AudioStatusButton";
import { getCurrentFactoryShift } from "@/lib/shifts";
import { useCriticalAlert } from "@/contexts/CriticalAlertContext";
import { cn } from "@/lib/utils";

/**
 * The phone's top bar. One row, 56px, four zones that never trade places:
 *
 *   [back | mark]  [title / day · shift]  [alerts]  [account]
 *
 * It replaced a 44px strip that held Back, a truncated title, a solid red pulsing
 * audio pill, the bell and a dark-mode moon, side by side. Three things were wrong
 * with it on a phone. The loudest object on every screen was a setting (the audio
 * pill), not the screen. Nothing said which day or shift the figures belonged to —
 * the desktop clock is hidden below 1024px, and on a system where a night that
 * starts on Monday is filed under Monday that is not decoration. And there was no
 * way to sign out or see who you were signed in as without opening the drawer and
 * scrolling to its foot.
 *
 * The title is the shell's (routeTitles), so it is the same words as the sidebar
 * row that opened the screen — less a trailing "Dashboard", which on a 390px bar
 * is the word that pushed "Production" into an ellipsis (see `shortTitle`).
 *
 * Second pass (19/10, evening): the bar carried five things on the right. Now it
 * carries what needs a person — the stopped-lines badge, and the alert sound ONLY
 * while it is muted, because then it is a fault — plus the bell and the account.
 * Sound on is the normal state and lives in the account menu with the theme.
 * On the home screen the left slot is the menu (there is nothing to go back to);
 * everywhere else it is Back, and the tab bar's Menu is one thumb away.
 */
export function MobileAppHeader({
  title,
  hidden,
  stoppedCount,
  onStoppedClick,
  stoppedLabel,
  showAudio,
  profileName,
  roleLabel,
  dark,
  onToggleDark,
  onSignOut,
  isHome,
  menuButton = false,
  leading,
  extra,
}: {
  title: string;
  /** Collapsed while the content scrolls down, so the 56px goes back to the page. */
  hidden: boolean;
  /** Lines called out and not resumed; 0 hides the badge. */
  stoppedCount: number;
  onStoppedClick: () => void;
  stoppedLabel: string;
  showAudio: boolean;
  profileName: string | null | undefined;
  roleLabel: string;
  dark: boolean;
  onToggleDark: () => void;
  onSignOut: () => void;
  isHome: boolean;
  /** Phones: a menu button that opens the navigation drawer. Tablets have `leading`. */
  menuButton?: boolean;
  /** Tablets only: the sidebar layout control, which is their way back to a hidden menu. */
  leading?: React.ReactNode;
  /** Shown from 768px, where there is room: who is online, and the like. */
  extra?: React.ReactNode;
}) {
  const { isMobile: hasDrawer, setOpenMobile, setOpen } = useSidebar();
  const openMenu = () => (hasDrawer ? setOpenMobile(true) : setOpen(true));
  return (
    <header
      className="sticky top-0 z-30 border-b bg-card/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-card/85 print:hidden"
      data-testid="mobile-app-header"
    >
      <div
        className={cn(
          "flex items-center gap-1 overflow-hidden px-1.5 transition-[height] duration-200 motion-reduce:transition-none",
          hidden ? "h-0" : "h-14",
        )}
      >
        {leading}
        {isHome ? (
          menuButton && (
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={openMenu} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
          )
        ) : (
          <BackButton iconOnly className="h-11 w-11 justify-center px-0" />
        )}

        <div className={cn("min-w-0 flex-1", isHome && !menuButton ? "pl-2" : "pl-0.5")}>
          <p className="truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-foreground" aria-current="page">
            {shortTitle(title)}
          </p>
          <ShiftLine />
        </div>

        {extra && <div className="hidden shrink-0 md:block">{extra}</div>}
        <div className="flex shrink-0 items-center">
          {stoppedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onStoppedClick}
              aria-label={stoppedLabel}
              className="mr-0.5 h-8 gap-1 rounded-full bg-destructive px-2.5 text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground"
            >
              <PowerOff className="h-3.5 w-3.5" />
              <span className="font-figure text-xs font-bold">{stoppedCount}</span>
            </Button>
          )}
          {showAudio && <MutedAlertSound />}
          <NotificationPanel />
          <AccountMenu
            name={profileName}
            roleLabel={roleLabel}
            dark={dark}
            onToggleDark={onToggleDark}
            onSignOut={onSignOut}
            alertSound={showAudio}
          />
        </div>
      </div>
    </header>
  );
}

/**
 * "Production Dashboard" → "Production", "Maintenance Dashboard" → "Maintenance".
 * A bare "Dashboard" stays: it is the whole name. Nothing else is rewritten — the
 * other titles are already the sidebar's words.
 */
export function shortTitle(title: string): string {
  const t = (title || "").trim();
  if (!t) return "PMSystem";
  const short = t.replace(/\s+Dashboard$/i, "");
  return short || t;
}

/** The alert-sound control, in the bar only while the sound is off: that is a fault. */
function MutedAlertSound() {
  const { audioEnabled, volume } = useCriticalAlert();
  if (audioEnabled && volume > 0) return null;
  return <AudioStatusButton compact />;
}

/**
 * "Mon 19 Oct · Night shift". The shift is the factory's (getCurrentFactoryShift), the
 * same one the desktop clock names, so a night that crosses midnight keeps its name.
 */
function ShiftLine() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const day = now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const shift = getCurrentFactoryShift().shiftCode === "night" ? "Night shift" : "Day shift";
  return (
    <p className="truncate text-2xs leading-tight text-muted-foreground">
      {day} · {shift}
    </p>
  );
}

/**
 * Who is signed in, and the two things a person does with that: change how the
 * screen looks, and leave. The moon used to sit in the bar on its own and sign-out
 * lived at the foot of the drawer, below every module.
 */
export function AccountMenu({
  name,
  roleLabel,
  dark,
  onToggleDark,
  onSignOut,
  alertSound = false,
}: {
  name: string | null | undefined;
  roleLabel: string;
  dark: boolean;
  onToggleDark: () => void;
  onSignOut: () => void;
  /** Engineers and admins: mute / unmute and test the critical-order siren here. */
  alertSound?: boolean;
}) {
  const { audioEnabled, volume, setVolume, testSound, promptEnableAudio } = useCriticalAlert();
  const soundOn = audioEnabled && volume > 0;
  const initial = name?.trim().charAt(0).toUpperCase() || "?";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-full"
          aria-label={`Account${name ? `: ${name}` : ""}`}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {initial}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-semibold text-foreground">{name || "Signed in"}</p>
          {roleLabel && (
            <p className="truncate text-2xs uppercase tracking-wider text-muted-foreground">{roleLabel}</p>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {alertSound && (
          <>
            <DropdownMenuItem
              className="min-h-11 gap-2"
              onSelect={() => {
                if (soundOn) return setVolume(0);
                if (volume === 0) setVolume(1);
                if (!audioEnabled) {
                  try { sessionStorage.removeItem("an_audio_prompted"); } catch { /* ignore */ }
                  promptEnableAudio();
                }
              }}
            >
              {soundOn ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              {soundOn ? "Mute alert sound" : "Turn alert sound on"}
              <span className="ml-auto text-2xs text-muted-foreground">{soundOn ? `${Math.round(volume * 100)}%` : "Off"}</span>
            </DropdownMenuItem>
            {soundOn && (
              <DropdownMenuItem className="min-h-11 gap-2" onSelect={() => testSound()}>
                <BellRing className="h-4 w-4" />
                Test siren
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem className="min-h-11 gap-2" onSelect={onToggleDark}>
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {dark ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11 gap-2 text-destructive-strong focus:text-destructive-strong" onSelect={onSignOut}>
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default MobileAppHeader;
