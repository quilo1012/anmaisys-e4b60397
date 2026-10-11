import { test, expect, type Page } from "@playwright/test";

/**
 * The "Create your account" sheet on a Zebra label, at the ZT231's 300dpi.
 *
 * The sheet carries no paper size of its own — it takes whatever the driver reports —
 * so this lays it out on the labels a ZT231 is likely to hold, and on A4 for the
 * office printer, and asks of each: is it one page, does everything sit inside the
 * paper, and does the QR, rendered at 300dpi, still read back as the signup link.
 *
 * Nothing here reaches the network.
 */

const PAYLOAD = "https://anmaisys.lovable.app/signup?code=AN-7KX4PQ";
const CODE = "AN-7KX4PQ";
const MM = 96 / 25.4;

const PAPERS = [
  { name: "100 × 150 mm label", w: 100, h: 150 },
  { name: "100 × 100 mm label", w: 100, h: 100 },
  { name: "100 × 50 mm label", w: 100, h: 50 },
  { name: "A4", w: 210, h: 297 },
];

async function drawLabel(page: Page) {
  await page.goto("/__label-test__");
  await page.evaluate(async ([payload, code]) => {
    const { writeSignupLabel } = await import("/src/lib/signupLabel.ts");
    // A blank document, as the print window is: none of the app's own styles.
    document.head.replaceChildren();
    document.body.replaceChildren();
    writeSignupLabel(document, { payload, code });
  }, [PAYLOAD, CODE] as const);
}

for (const paper of PAPERS) {
  test(`fits one ${paper.name} and the QR reads back at 300dpi`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: Math.round(paper.w * MM), height: Math.round(paper.h * MM) },
      deviceScaleFactor: 300 / 96,
    });
    const page = await ctx.newPage();
    await drawLabel(page);
    await page.emulateMedia({ media: "print" });

    // Everything inside the paper.
    const out = await page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      return [...document.querySelectorAll<HTMLElement | SVGElement>("main *")]
        .map((el) => ({ tag: el.tagName, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5)
        .map(({ tag, r }) => `${tag} ${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`);
    });
    expect(out, "something is off the paper").toEqual([]);

    // A QR under ~25mm stops being reliable for a phone at arm's length.
    const qrMm = await page.evaluate(() => document.querySelector("svg.qr")!.getBoundingClientRect().width) / MM;
    expect(qrMm).toBeGreaterThan(paper.h <= 50 ? 30 : 45);

    // One sheet, never a second label.
    const pdf = await page.pdf({ width: `${paper.w}mm`, height: `${paper.h}mm`, printBackground: true });
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBe(1);
    await test.info().attach(`${paper.name}.pdf`, { body: pdf, contentType: "application/pdf" });
    if (process.env.LABEL_OUT) {
      const fs = await import("node:fs");
      fs.writeFileSync(`${process.env.LABEL_OUT}/${paper.w}x${paper.h}.pdf`, pdf);
    }

    // Read it back, from pixels, the way a phone would.
    const png = await page.screenshot({ type: "png" });
    await test.info().attach(`${paper.name}.png`, { body: png, contentType: "image/png" });
    const decoded = await page.evaluate(async (b64) => {
      const { Html5Qrcode } = await import("/node_modules/.vite/deps/html5-qrcode.js").catch(
        () => import("html5-qrcode" as string),
      );
      const host = document.createElement("div");
      host.id = "qr-reader-test";
      host.style.display = "none";
      document.body.appendChild(host);
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const file = new File([blob], "label.png", { type: "image/png" });
      return new Html5Qrcode("qr-reader-test", { verbose: false }).scanFile(file, false);
    }, png.toString("base64"));
    expect(decoded).toBe(PAYLOAD);

    await ctx.close();
  });
}
