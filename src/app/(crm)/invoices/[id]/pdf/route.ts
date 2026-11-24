import type { NextRequest } from "next/server";
import { getInvoice } from "@/lib/data/invoices";
import { invoicePdf } from "@/lib/invoice-pdf";
import { getAgencySettings } from "@/lib/data/settings";

// GET /invoices/<id>/pdf → the invoice as a PDF download.
// Loaded as the signed-in user (src/proxy.ts sends logged-out visitors to /login),
// so Row Level Security decides who may download which invoice.
export async function GET(_req: NextRequest, ctx: RouteContext<"/invoices/[id]/pdf">) {
  const { id } = await ctx.params;
  const [data, settings] = await Promise.all([getInvoice(id), getAgencySettings()]);
  if (!data) return new Response("Invoice not found.", { status: 404 });

  const inv = data.invoice;
  const bytes = await invoicePdf(inv, new Date().toISOString().slice(0, 10), settings);
  const name = inv.number ? `${inv.number}.pdf` : `draft-invoice-${inv.bookingCode}.pdf`;
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
