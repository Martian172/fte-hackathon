import { jsPDF } from "jspdf";
import type { ResearchReport } from "./types";

/**
 * Client-side PDF report builder (jsPDF — same approach as the reference app).
 * A4, dark header band, sectioned layout, clickable links, page numbers.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

/**
 * jsPDF's built-in fonts only cover WinAnsi (Latin-1). LLM output often contains
 * Unicode punctuation (non-breaking hyphens, smart quotes, NBSP) which renders as
 * broken glyph spacing ("C o l o r e d"). Normalize everything to safe equivalents.
 */
const CHAR_MAP: Record<string, string> = {
  " ": " ", "‘": "'", "’": "'", "“": '"', "”": '"',
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-",
  "…": "...", "•": "-", "′": "'", "×": "x", "→": "->",
  "₹": "Rs ", "€": "EUR ", "­": "",
};

export function sanitizePdfText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[ ‘’“”‐-―…•′×→₹€­]/g, (c) => CHAR_MAP[c] ?? "")
    .replace(/[^\x20-\x7EÀ-ÿ]/g, "") // drop anything else outside WinAnsi
    .replace(/\s+/g, " ")
    .trim();
}

const AMBER: [number, number, number] = [245, 158, 11];
const DARK: [number, number, number] = [17, 17, 19];
const TEXT: [number, number, number] = [28, 28, 30];
const GRAY: [number, number, number] = [110, 110, 118];
const LINE: [number, number, number] = [225, 225, 228];

class PdfBuilder {
  doc = new jsPDF({ unit: "pt", format: "a4" });
  y = 0;

  ensure(height: number): void {
    if (this.y + height > PAGE_H - 64) {
      this.doc.addPage();
      this.y = 56;
    }
  }

  sectionTitle(title: string): void {
    this.ensure(46);
    this.y += 18;
    this.doc.setFont("courier", "bold").setFontSize(9).setTextColor(...AMBER);
    this.doc.text(title.toUpperCase(), MARGIN, this.y);
    this.y += 6;
    this.doc.setDrawColor(...LINE).setLineWidth(0.75);
    this.doc.line(MARGIN, this.y, PAGE_W - MARGIN, this.y);
    this.y += 14;
  }

  keyValue(label: string, rawValue: string | null): void {
    const value = rawValue ? sanitizePdfText(rawValue) : null;
    const text = value || "Not publicly listed";
    const lines = this.doc.setFont("helvetica", "bold").setFontSize(10).splitTextToSize(text, CONTENT_W - 130) as string[];
    const h = Math.max(14, lines.length * 13);
    this.ensure(h + 4);
    this.doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...GRAY);
    this.doc.text(label, MARGIN, this.y);
    this.doc.setFont("helvetica", value ? "bold" : "italic").setFontSize(10);
    this.doc.setTextColor(...(value ? TEXT : GRAY));
    this.doc.text(lines, MARGIN + 130, this.y);
    this.y += h + 4;
  }

  paragraph(rawText: string): void {
    const text = sanitizePdfText(rawText);
    const lines = this.doc.setFont("helvetica", "normal").setFontSize(10).splitTextToSize(text, CONTENT_W) as string[];
    for (const line of lines) {
      this.ensure(14);
      this.doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...TEXT);
      this.doc.text(line, MARGIN, this.y);
      this.y += 14;
    }
  }

  bullet(rawText: string, color: [number, number, number] = AMBER): void {
    const text = sanitizePdfText(rawText);
    const lines = this.doc.setFont("helvetica", "normal").setFontSize(10).splitTextToSize(text, CONTENT_W - 18) as string[];
    this.ensure(lines.length * 13.5 + 4);
    this.doc.setTextColor(...color).setFont("helvetica", "bold");
    this.doc.text("•", MARGIN + 2, this.y);
    this.doc.setFont("helvetica", "normal").setTextColor(...TEXT);
    this.doc.text(lines, MARGIN + 18, this.y);
    this.y += lines.length * 13.5 + 4;
  }

  link(text: string, url: string, x: number): void {
    this.doc.setTextColor(37, 99, 235);
    this.doc.textWithLink(text, x, this.y, { url });
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "company";
}

export function buildPdf(report: ResearchReport): { blob: Blob; fileName: string } {
  const b = new PdfBuilder();
  const { profile, competitors } = report;
  const doc = b.doc;

  // Header band
  doc.setFillColor(...DARK).rect(0, 0, PAGE_W, 118, "F");
  doc.setFillColor(...AMBER).rect(0, 118, PAGE_W, 3, "F");
  doc.setFont("courier", "bold").setFontSize(8.5).setTextColor(...AMBER);
  doc.text("COMPANY RESEARCH AI  ·  COMPANY RESEARCH REPORT", MARGIN, 40);
  doc.setFont("helvetica", "bold").setFontSize(24).setTextColor(255, 255, 255);
  doc.text(sanitizePdfText(profile.companyName).slice(0, 48), MARGIN, 74);
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(200, 200, 205);
  const generated = new Date(report.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  doc.text(`${profile.website}   ·   Generated ${generated}   ·   Model: ${report.modelUsed}`, MARGIN, 96);
  b.y = 140;

  // Company information
  b.sectionTitle("Company Information");
  b.keyValue("Company Name", profile.companyName);
  b.keyValue("Website", profile.website);
  b.keyValue("Phone", profile.phone);
  b.keyValue("Address", profile.address);
  if (profile.industry) b.keyValue("Industry", profile.industry);
  if (profile.hqCountry) b.keyValue("HQ Country", profile.hqCountry);
  if (profile.foundedYear) b.keyValue("Founded", profile.foundedYear);
  if (profile.founders?.length) b.keyValue("Founders", profile.founders.join(", "));

  if (profile.summary) {
    b.sectionTitle("Company Summary");
    b.paragraph(profile.summary);
  }

  b.sectionTitle("Products & Services");
  for (const p of profile.productsServices) b.bullet(p);

  b.sectionTitle("AI-Generated Pain Points");
  for (const p of profile.painPoints) b.bullet(p);

  // Competitors
  b.sectionTitle("Competitors");
  if (competitors.length === 0) {
    b.paragraph("No competitors identified.");
  }
  for (const c of competitors) {
    b.ensure(c.reason ? 44 : 30);
    doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(...TEXT);
    doc.text(sanitizePdfText(c.name).slice(0, 60), MARGIN, b.y);
    doc.setFont("helvetica", "normal").setFontSize(9);
    b.link(c.website, c.website, MARGIN + 220);
    b.y += 14;
    if (c.reason) {
      const lines = doc.setFontSize(8.5).splitTextToSize(sanitizePdfText(c.reason), CONTENT_W) as string[];
      doc.setTextColor(...GRAY);
      doc.text(lines.slice(0, 2), MARGIN, b.y);
      b.y += Math.min(lines.length, 2) * 11 + 3;
    }
    doc.setDrawColor(...LINE).setLineWidth(0.5);
    doc.line(MARGIN, b.y, PAGE_W - MARGIN, b.y);
    b.y += 12;
  }

  // Sources (crawled pages + search)
  if (report.sources.length > 0) {
    b.sectionTitle("Sources");
    for (const s of report.sources.slice(0, 8)) {
      b.ensure(13);
      doc.setFont("helvetica", "normal").setFontSize(8.5);
      b.link(s.slice(0, 90), s, MARGIN);
      b.y += 12;
    }
    b.ensure(13);
    doc.setFontSize(8.5).setTextColor(...GRAY);
    doc.text("Plus Google Search results via Serper.dev", MARGIN, b.y);
    b.y += 12;
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...GRAY);
    doc.text("Generated by Company Research AI", MARGIN, PAGE_H - 30);
    doc.text(`Page ${i} / ${pages}`, PAGE_W - MARGIN, PAGE_H - 30, { align: "right" });
  }

  return {
    blob: doc.output("blob"),
    fileName: `${slugify(profile.companyName)}-research-report.pdf`,
  };
}

/** Blob → raw base64 (no data: prefix) for the Discord upload API route. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error ?? new Error("Failed to read PDF blob"));
    fr.readAsDataURL(blob);
  });
  return dataUrl.split(",", 2)[1] ?? "";
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
