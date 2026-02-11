

# Fix: Replace Web Audio API with HTML5 Audio for Reliable Sound

## Root Cause

The Web Audio API (`AudioContext` + oscillators) is unreliable for alert sounds in many browsers and environments. Even with the warmup pattern, some browsers still block or silently fail to play oscillator-generated sounds. The toast message works, but the sound does not.

## Solution

Replace the `AudioContext` oscillator approach with **HTML5 `Audio` element** using a base64-encoded WAV alarm sound. This is significantly more reliable because:
- `new Audio(dataURI)` works more consistently across browsers
- It can be pre-loaded ("warmed up") with a silent play on first user gesture
- It does not depend on `AudioContext` state management

## Technical Details

### File: `src/lib/shifts.ts`

- Remove all `AudioContext` / oscillator code
- Generate a short alarm WAV as a base64 data URI (a simple beep pattern)
- Create an `Audio` element, pre-load it
- `warmUpAudio()`: on first user gesture, call `audio.play()` with volume 0 to unlock playback
- `playAlertSound()`: set volume to 1.0, reset `currentTime`, and call `audio.play()`
- Add a fallback: if `Audio` fails, try `AudioContext` as backup

### File: `src/hooks/useWOAlerts.ts`

- No changes needed (already calls `warmUpAudio` on gesture and `playAlertSound` on WO insert)

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/shifts.ts` | Replace AudioContext with HTML5 Audio + base64 WAV |

