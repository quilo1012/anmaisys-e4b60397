import { PRIVACY_CONTACT_EMAIL, PRIVACY_CONTROLLER } from "@/lib/privacyContact";

/**
 * The privacy page the Google Play listing links to (and any browser can open without
 * signing in). It says what the system holds and who processes it, from what the system
 * actually does — nothing about retention periods or legal bases, which are the company's
 * to state; those belong in the contact line, not here. Review it with whoever answers for
 * data protection at the company before the listing goes live.
 */
export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Privacy</h1>
      <p className="mt-1 text-muted-foreground">PMSYSTEM — {PRIVACY_CONTROLLER}</p>

      <p className="mt-6">
        This app is the internal system of {PRIVACY_CONTROLLER}, used by its employees and contractors for
        maintenance, production, quality, workforce planning, attendance and overtime. It is not a public
        service and is not meant for anybody who does not have an account given by the company.
      </p>

      <h2 className="mt-8 text-lg font-semibold">What the system holds</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Your account: name, email or badge number, role, and the profile photo if you add one.</li>
        <li>Your employee record: department, shift, rota, attendance, leave and overtime offered, accepted or declined.</li>
        <li>Work records you create: work orders, production and quality entries, downtime, and an audit trail of who changed what.</li>
        <li>Messages you send or receive in the app's chat, including photos, files and voice notes.</li>
        <li>If you turn on notifications: a push subscription for your phone or browser (an address issued by Apple, Google or Mozilla's push service, plus the keys needed to send you a message). It is used only to deliver your notifications.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">What it does not use</h2>
      <p className="mt-2">
        The app does not ask for your location. It asks for the camera only when you choose to take a photo, and
        the microphone only when you record a voice note.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Who processes it for us</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Hosting and database: Lovable Cloud (Supabase).</li>
        <li>Translation of chat messages, part identification and report analysis: Anthropic, only for the text or photo you submit to that feature.</li>
        <li>Transcription of voice notes: Lovable's AI gateway, only for the recording you choose to send.</li>
        <li>Notification delivery: the push service of your device's maker or browser (Apple, Google, Mozilla).</li>
        <li>Attendance clock data is imported from the company's TimeMoto system, and production data from its InTouch system. The system also connects to the company's SharePoint, SafetyCulture and Microsoft Teams.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Your choices</h2>
      <p className="mt-2">
        You can turn notifications off at any time in the app or in your phone's settings. To see, correct or ask
        for the removal of your data, {PRIVACY_CONTACT_EMAIL
          ? <>write to <a className="text-primary underline" href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>{PRIVACY_CONTACT_EMAIL}</a>.</>
          : <>speak to your supervisor or the system administrator at {PRIVACY_CONTROLLER}.</>}
      </p>
    </main>
  );
}
