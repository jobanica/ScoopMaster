import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { D, Decimal } from "@/lib/money";
import { fmtDateTime } from "@/lib/dates";
import { formatCell, totalsFor, type Cell, type Column, type ReportResult } from "./reports";
import { LOGO_ASPECT, LOGO_PNG_DATA_URL } from "@/lib/brand-logo";

function csvEscape(s: string) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(r: ReportResult): string {
  const head = r.columns.map((c) => csvEscape(c.label)).join(",");
  const body = r.rows.map((row) => r.columns.map((c) => csvEscape(c.type === "money" ? D(row[c.key] as Decimal).toFixed(2) : formatCell(row[c.key], c.type, { currency: "none" }))).join(","));
  const t = totalsFor(r);
  const total = t ? [r.columns.map((c, i) => (i === 0 ? "TOTAL" : c.key in t ? (c.type === "money" ? D(t[c.key] as Decimal).toFixed(2) : String(t[c.key])) : "")).join(",")] : [];
  return "﻿" + [head, ...body, ...total].join("\r\n"); // BOM so Excel opens UTF-8 (₱) correctly
}

const PESO_FMT = '"₱"#,##0.00;[Red]-"₱"#,##0.00';

export async function toXLSX(title: string, subtitle: string, r: ReportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SCOOP MASTER";
  const ws = wb.addWorksheet(title.slice(0, 31));
  ws.addRow([`SCOOP MASTER — ${title}`]).font = { bold: true, size: 14 };
  ws.addRow([subtitle]).font = { italic: true, color: { argb: "FF7A4E36" } };
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: "FFFFF8EC" } };
  header.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF523325" } }; });
  const cellValue = (v: Cell, c: Column) => {
    if (v === null || v === undefined) return null;
    if (c.type === "money" || c.type === "qty" || c.type === "pct") return Number(D(v as Decimal).toFixed(c.type === "qty" ? 4 : 2)); // spreadsheet display value
    if (c.type === "date" && v instanceof Date) return formatCell(v, "date");
    return v as string | number;
  };
  for (const row of r.rows) ws.addRow(r.columns.map((c) => cellValue(row[c.key], c)));
  const t = totalsFor(r);
  if (t) { const tr = ws.addRow(r.columns.map((c, i) => (i === 0 ? "TOTAL" : c.key in t ? cellValue(t[c.key], c) : null))); tr.font = { bold: true }; }
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(45, Math.max(12, c.label.length + 4));
    if (c.type === "money") col.numFmt = PESO_FMT;
    if (c.type === "pct") col.numFmt = '0.0"%"';
  });
  for (const n of r.notes ?? []) ws.addRow([n]).font = { italic: true, size: 9 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

type PdfSection = { heading?: string; columns: { label: string; align?: "left" | "right" }[]; rows: string[][]; foot?: string[] } | { heading?: string; text: string[] } | { heading?: string; pairs: [string, string][] };

/** Generic branded PDF. Standard PDF fonts lack the ₱ glyph, so amounts are written as "PHP". */
export function buildPDF(title: string, subtitle: string, sections: PdfSection[], landscape = false): Buffer {
  const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  // Brand header: logo on white, chocolate rule underneath
  const logoW = 150, logoH = logoW * LOGO_ASPECT;
  doc.addImage(LOGO_PNG_DATA_URL, "PNG", 36, 14, logoW, logoH);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(122, 78, 54).text("Soft-Serve Ice Cream Business Management System", w - 36, 30, { align: "right" });
  doc.setDrawColor(82, 51, 37).setLineWidth(1.5).line(36, 22 + logoH, w - 36, 22 + logoH);
  const top = 22 + logoH;
  doc.setTextColor(43, 26, 18);
  doc.setFont("helvetica", "bold").setFontSize(14).text(title, 36, top + 26);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(122, 78, 54).text(subtitle, 36, top + 41);
  let y = top + 58;
  for (const s of sections) {
    if (s.heading) { doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(43, 26, 18).text(s.heading, 36, y + 6); y += 14; }
    if ("rows" in s) {
      autoTable(doc, {
        startY: y, head: [s.columns.map((c) => c.label)], body: s.rows, foot: s.foot ? [s.foot] : undefined, margin: { left: 36, right: 36 },
        styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [122, 78, 54], textColor: [255, 248, 236] }, footStyles: { fillColor: [251, 239, 217], textColor: [43, 26, 18], fontStyle: "bold" },
        columnStyles: Object.fromEntries(s.columns.map((c, i) => [i, { halign: c.align ?? "left" }])),
        alternateRowStyles: { fillColor: [255, 253, 248] },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
    } else if ("pairs" in s) {
      autoTable(doc, { startY: y, body: s.pairs, theme: "plain", margin: { left: 36, right: 36 }, styles: { fontSize: 9, cellPadding: 2 }, columnStyles: { 0: { fontStyle: "bold", cellWidth: 200 }, 1: { halign: "right" } } });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
    } else {
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(90, 60, 40);
      for (const line of s.text) { const parts = doc.splitTextToSize(line, w - 72); doc.text(parts, 36, y); y += parts.length * 10 + 2; }
      y += 6;
    }
    if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 50; }
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7).setTextColor(150, 120, 100).text(`Generated ${fmtDateTime(new Date())} (Asia/Manila) · Page ${i} of ${pages}`, 36, doc.internal.pageSize.getHeight() - 20);
  }
  return Buffer.from(doc.output("arraybuffer"));
}

export function reportToPDF(title: string, subtitle: string, r: ReportResult): Buffer {
  const t = totalsFor(r);
  return buildPDF(title, subtitle, [
    { columns: r.columns.map((c) => ({ label: c.label, align: ["money", "qty", "int", "pct"].includes(c.type) ? "right" : "left" })), rows: r.rows.map((row) => r.columns.map((c) => formatCell(row[c.key], c.type, { currency: "text" }))), foot: t ? r.columns.map((c, i) => (i === 0 ? "TOTAL" : c.key in t ? formatCell(t[c.key], c.type, { currency: "text" }) : "")) : undefined },
    ...(r.notes?.length ? [{ text: r.notes }] : []),
  ], r.columns.length > 6);
}

export { Decimal };
