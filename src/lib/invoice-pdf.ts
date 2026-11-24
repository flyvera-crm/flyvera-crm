// Builds the downloadable PDF of an invoice (server-side) with pdf-lib.
// The content mirrors the on-screen invoice; issued invoices are frozen, so the PDF never changes.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Invoice } from "@/types/invoices";
import { balanceDue, invoiceStatus } from "@/lib/invoice-rules";
import { siteConfig } from "@/config/site";
import { QUOTE_TERMS } from "@/config/quote-options";

const NAVY = rgb(0.043, 0.122, 0.227);
const GREY = rgb(0.33, 0.42, 0.55);
const LIGHT = rgb(0.84, 0.88, 0.94);
const GOLD = rgb(0.79, 0.64, 0.15);

/** The standard PDF fonts only cover Western European characters: keep accents, simplify the rest. */
function safe(text: string) {
  return Array.from(text.normalize("NFC"))
    .map((ch) => {
      if (/[ -~ -ÿ]/.test(ch)) return ch;
      if (ch === "–" || ch === "—") return "-";
      if (ch === "’" || ch === "‘") return "'";
      if (ch === "“" || ch === "”") return '"';
      if (ch === "→") return "->";
      const base = ch.normalize("NFD")[0];
      return /[ -~]/.test(base) ? base : "?";
    })
    .join("");
}

const money = (n: number, currency: string) =>
  `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (iso?: string) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "-";

export async function invoicePdf(inv: Invoice, today: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(inv.number ? `Invoice ${inv.number}` : "Draft invoice");
  pdf.setAuthor(siteConfig.name);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595.28, 841.89]); // A4
  const W = 595.28;
  const M = 48;
  let y = 841.89 - M;

  const text = (s: string, x: number, size = 10, f: PDFFont = font, color = NAVY, p: PDFPage = page) =>
    p.drawText(safe(s), { x, y, size, font: f, color });
  const right = (s: string, xRight: number, size = 10, f: PDFFont = font, color = NAVY) => {
    const t = safe(s);
    page.drawText(t, { x: xRight - f.widthOfTextAtSize(t, size), y, size, font: f, color });
  };
  const wrap = (s: string, width: number, size: number, f: PDFFont = font) => {
    const words = safe(s).split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const newPageIfNeeded = (needed: number) => {
    if (y - needed > M) return;
    page = pdf.addPage([595.28, 841.89]);
    y = 841.89 - M;
  };

  // Header band
  page.drawRectangle({ x: 0, y: 841.89 - 110, width: W, height: 110, color: NAVY });
  y = 841.89 - 52;
  text(siteConfig.name, M, 22, bold, rgb(1, 1, 1));
  right(inv.number ? `INVOICE ${inv.number}` : "DRAFT INVOICE", W - M, 14, bold, rgb(1, 1, 1));
  y -= 18;
  text(siteConfig.tagline ?? "", M, 9, font, GOLD);
  right(inv.issueOn ? `Issued ${date(inv.issueOn)}` : "Not issued yet", W - M, 9, font, rgb(0.85, 0.9, 1));
  y -= 13;
  right(inv.dueOn ? `Due ${date(inv.dueOn)}` : "", W - M, 9, font, rgb(0.85, 0.9, 1));

  const status = invoiceStatus(inv, today);
  y = 841.89 - 140;
  if (status === "Void") {
    text(`VOID${inv.voidReason ? ` - ${inv.voidReason}` : ""}`, M, 12, bold, rgb(0.75, 0.1, 0.15));
    y -= 22;
  } else if (status === "Draft") {
    text("DRAFT - not a valid tax invoice until issued", M, 11, bold, rgb(0.6, 0.4, 0));
    y -= 22;
  }

  // Bill to / booking
  text("BILL TO", M, 8, bold, GREY);
  text("BOOKING", W / 2, 8, bold, GREY);
  y -= 14;
  text(inv.billTo.name, M, 11, bold);
  text(`${inv.bookingCode} - ${inv.bookingTitle}`.slice(0, 60), W / 2, 10, bold);
  y -= 13;
  const billLines = [inv.billTo.email ?? "", inv.billTo.phone ?? "", [inv.billTo.city, inv.billTo.country].filter(Boolean).join(", "), inv.billTo.code ? `Customer ${inv.billTo.code}` : ""].filter(Boolean);
  const paxLines = inv.passengers.map((p) => `${p.name} (${p.type})${p.tickets.length ? ` - ticket ${p.tickets.join(", ")}` : ""}`);
  const rows = Math.max(billLines.length, paxLines.length ? paxLines.length + 1 : 0);
  for (let i = 0; i < rows; i++) {
    if (billLines[i]) text(billLines[i], M, 9, font, GREY);
    if (i === 0 && paxLines.length) text("Passengers", W / 2, 8, bold, GREY);
    else if (paxLines[i - 1]) text(paxLines[i - 1].slice(0, 70), W / 2, 9, font, GREY);
    y -= 12;
  }

  // Lines table
  y -= 14;
  const cols = { type: M, desc: M + 78, qty: W - M - 190, unit: W - M - 100, total: W - M };
  page.drawRectangle({ x: M - 6, y: y - 6, width: W - 2 * M + 12, height: 20, color: rgb(0.95, 0.96, 0.98) });
  y += 1;
  text("TYPE", cols.type, 8, bold, GREY);
  text("DESCRIPTION", cols.desc, 8, bold, GREY);
  right("QTY", cols.qty + 20, 8, bold, GREY);
  right("UNIT PRICE", cols.unit + 40, 8, bold, GREY);
  right("AMOUNT", cols.total, 8, bold, GREY);
  y -= 22;
  for (const l of inv.lines) {
    const descLines = wrap(l.description, cols.qty - cols.desc - 30, 9);
    newPageIfNeeded(14 * descLines.length + 6);
    text(l.type, cols.type, 9, bold);
    right(String(l.quantity), cols.qty + 20, 9);
    right(money(l.unitPrice, inv.currency), cols.unit + 40, 9);
    right(money(l.total, inv.currency), cols.total, 9, bold);
    for (const d of descLines) {
      text(d, cols.desc, 9);
      y -= 13;
    }
    page.drawLine({ start: { x: M, y: y + 5 }, end: { x: W - M, y: y + 5 }, thickness: 0.5, color: LIGHT });
    y -= 4;
  }

  // Totals
  newPageIfNeeded(120);
  y -= 8;
  const tx = W - M - 200;
  const row = (label: string, value: string, f: PDFFont = font, size = 10) => {
    text(label, tx, size, f, label === "Total" ? NAVY : GREY);
    right(value, W - M, size, f);
    y -= size + 6;
  };
  row("Subtotal", money(inv.subtotal, inv.currency));
  if (inv.discount > 0) row("Discount", `- ${money(inv.discount, inv.currency)}`);
  if (inv.tax > 0) row(`Tax (${inv.taxRate}%)`, money(inv.tax, inv.currency));
  page.drawLine({ start: { x: tx, y: y + 10 }, end: { x: W - M, y: y + 10 }, thickness: 1, color: NAVY });
  y -= 4;
  row("Total", money(inv.total, inv.currency), bold, 13);
  if (status !== "Draft" && status !== "Void") {
    row("Paid", money(inv.paid, inv.currency));
    row("Balance due", money(balanceDue(inv), inv.currency), bold);
  }

  // Payments
  if (inv.payments.length && status !== "Draft") {
    newPageIfNeeded(40 + inv.payments.length * 13);
    y -= 10;
    text("PAYMENTS", M, 8, bold, GREY);
    y -= 14;
    for (const p of inv.payments) {
      const label = p.kind === "refund" ? `Refund ${p.id.replace(/\D/g, "")}` : `Receipt ${p.id.replace(/\D/g, "")}`;
      text(`${date(p.date)}   ${label}   ${p.method}`, M, 9, font, GREY);
      right(`${p.kind === "refund" ? "- " : ""}${money(p.amount, inv.currency)}`, M + 330, 9);
      y -= 13;
    }
  }

  // Notes & terms
  const notes = [...(inv.notes ? [inv.notes] : []), ...QUOTE_TERMS];
  newPageIfNeeded(30 + notes.length * 24);
  y -= 16;
  text("NOTES & TERMS", M, 8, bold, GREY);
  y -= 13;
  for (const t of notes) {
    for (const l of wrap(t, W - 2 * M, 8.5)) {
      newPageIfNeeded(12);
      text(l, M, 8.5, font, GREY);
      y -= 11;
    }
    y -= 3;
  }

  return pdf.save();
}
