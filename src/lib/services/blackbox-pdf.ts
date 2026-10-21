/**
 * Suraksha Grid — Safety Black Box PDF Generator
 *
 * Generates an authentic, vector PDF-1.4 report directly on the client.
 * Features:
 * - Zero external npm dependencies.
 * - Multi-page pagination with clean headers, footers, and page numbers.
 * - Real vector mini-map path rendering from recorded coordinates.
 * - Chronological event timeline with coordinates and accuracy.
 * - Missing telemetry disclosures and non-tamper disclaimers.
 */

import { formatCoordinates, formatAccuracy, formatDuration, formatDistance } from "./geocoding";
import type { JourneyRecord, JourneyEvent } from "@/types/blackbox";

function escapePdfString(str: unknown): string {
  if (typeof str !== "string") {
    str = String(str ?? "");
  }
  return (str as string)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, " "); // Keep ASCII printable
}

interface PageStream {
  operations: string[];
}

export function generateJourneyPdfBlob(journey: JourneyRecord): Blob {
  const pageWidth = 595.28; // A4 width in points
  const pageHeight = 841.89; // A4 height in points
  const marginX = 42;
  const contentWidth = pageWidth - marginX * 2; // 511.28 pt

  const pages: PageStream[] = [];
  let currentPageOps: string[] = [];
  let currentY = pageHeight - 45;

  function flushPage() {
    if (currentPageOps.length > 0) {
      pages.push({ operations: currentPageOps });
      currentPageOps = [];
      currentY = pageHeight - 55;
    }
  }

  function ensureSpace(neededHeight: number) {
    if (currentY - neededHeight < 60) {
      flushPage();
      drawPageHeader(false);
    }
  }

  // --- PDF Drawing Helpers ---

  function setFillColor(r: number, g: number, b: number) {
    currentPageOps.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
  }

  function setStrokeColor(r: number, g: number, b: number) {
    currentPageOps.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`);
  }

  function setLineWidth(w: number) {
    currentPageOps.push(`${w.toFixed(2)} w`);
  }

  function drawRect(x: number, y: number, w: number, h: number, fill = true, stroke = false) {
    const op = fill && stroke ? "B" : fill ? "f" : "s";
    currentPageOps.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${op}`);
  }

  function drawLine(x1: number, y1: number, x2: number, y2: number) {
    currentPageOps.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  function drawText(
    text: string,
    x: number,
    y: number,
    font: "/F1" | "/F2" | "/F3",
    size: number,
    r = 0.043,
    g = 0.122,
    b = 0.2
  ) {
    setFillColor(r, g, b);
    const safe = escapePdfString(text);
    currentPageOps.push(`BT ${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${safe}) Tj ET`);
  }

  // --- Top Branding and Header ---

  function drawPageHeader(isFirstPage: boolean) {
    // Top Teal Accent Bar
    setFillColor(0.055, 0.486, 0.525);
    drawRect(0, pageHeight - 8, pageWidth, 8, true, false);

    if (isFirstPage) {
      // Header badge
      setFillColor(0.9, 0.96, 0.96);
      drawRect(marginX, currentY - 18, 140, 18, true, false);
      drawText("SURAKSHA GRID", marginX + 8, currentY - 14, "/F2", 9, 0.04, 0.36, 0.39);

      // Main Title
      currentY -= 28;
      drawText("Safety Black Box — Journey Report", marginX, currentY, "/F2", 18, 0.043, 0.122, 0.2);

      // Subtitle with unique Journey ID
      currentY -= 15;
      drawText(`Report Reference: ${journey.id}`, marginX, currentY, "/F3", 9, 0.357, 0.42, 0.498);

      currentY -= 15;
      setStrokeColor(0.89, 0.91, 0.94);
      setLineWidth(1);
      drawLine(marginX, currentY, marginX + contentWidth, currentY);
      currentY -= 15;
    } else {
      // Subsequent page simplified header
      drawText("SURAKSHA GRID — Safety Black Box Report", marginX, currentY, "/F2", 9, 0.055, 0.486, 0.525);
      drawText(`ID: ${journey.id}`, marginX + contentWidth - 160, currentY, "/F1", 8, 0.357, 0.42, 0.498);
      currentY -= 8;
      setStrokeColor(0.89, 0.91, 0.94);
      setLineWidth(0.75);
      drawLine(marginX, currentY, marginX + contentWidth, currentY);
      currentY -= 20;
    }
  }

  // --- Page 1 Content Assembly ---

  drawPageHeader(true);

  // 1. Overview Summary Card
  const startDate = new Date(journey.startTime);
  const endDate = journey.endTime ? new Date(journey.endTime) : null;
  const startStr = startDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + `, ${startDate.toLocaleDateString()}`;
  const endStr = endDate
    ? endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + `, ${endDate.toLocaleDateString()}`
    : "In progress / Unfinished";

  setFillColor(0.96, 0.97, 0.98);
  drawRect(marginX, currentY - 70, contentWidth, 70, true, false);
  setStrokeColor(0.89, 0.91, 0.94);
  setLineWidth(1);
  drawRect(marginX, currentY - 70, contentWidth, 70, false, true);

  // Metrics 4-column layout
  const colW = contentWidth / 4;
  const labelsY = currentY - 22;
  const valuesY = currentY - 42;
  const subY = currentY - 58;

  // Col 1: Duration
  drawText("TOTAL DURATION", marginX + 12, labelsY, "/F2", 7.5, 0.357, 0.42, 0.498);
  drawText(formatDuration(journey.durationSeconds), marginX + 12, valuesY, "/F2", 13, 0.043, 0.122, 0.2);
  drawText(`Started ${startDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, marginX + 12, subY, "/F1", 7.5, 0.357, 0.42, 0.498);

  // Col 2: Distance
  drawText("RECORDED DISTANCE", marginX + colW + 8, labelsY, "/F2", 7.5, 0.357, 0.42, 0.498);
  drawText(formatDistance(journey.totalDistanceMeters), marginX + colW + 8, valuesY, "/F2", 13, 0.043, 0.122, 0.2);
  drawText("GPS ground track", marginX + colW + 8, subY, "/F1", 7.5, 0.357, 0.42, 0.498);

  // Col 3: GPS Points
  drawText("TELEMETRY POINTS", marginX + colW * 2 + 8, labelsY, "/F2", 7.5, 0.357, 0.42, 0.498);
  drawText(`${journey.points.length} points`, marginX + colW * 2 + 8, valuesY, "/F2", 13, 0.043, 0.122, 0.2);
  drawText(journey.hasInaccuratePoints ? "Variable accuracy" : "Verified GPS fixes", marginX + colW * 2 + 8, subY, "/F1", 7.5, 0.357, 0.42, 0.498);

  // Col 4: Status
  drawText("JOURNEY STATUS", marginX + colW * 3 + 8, labelsY, "/F2", 7.5, 0.357, 0.42, 0.498);
  const statusColor = journey.status === "completed" ? [0.086, 0.639, 0.29] : [0.917, 0.345, 0.047];
  drawText(journey.status.toUpperCase(), marginX + colW * 3 + 8, valuesY, "/F2", 12, statusColor[0], statusColor[1], statusColor[2]);
  drawText(journey.status === "completed" ? "Successfully ended" : "Interrupted / Open", marginX + colW * 3 + 8, subY, "/F1", 7.5, 0.357, 0.42, 0.498);

  currentY -= 88;

  // 2. Start & Destination Route Summary Card
  setFillColor(1, 1, 1);
  setStrokeColor(0.89, 0.91, 0.94);
  setLineWidth(1);
  drawRect(marginX, currentY - 50, contentWidth, 50, true, true);

  drawText("DEPARTURE POINT", marginX + 12, currentY - 18, "/F2", 8, 0.055, 0.486, 0.525);
  drawText(journey.startLocationName || "Starting point coordinates recorded", marginX + 12, currentY - 32, "/F2", 10, 0.043, 0.122, 0.2);
  drawText(startStr, marginX + 12, currentY - 44, "/F1", 8, 0.357, 0.42, 0.498);

  const destX = marginX + contentWidth / 2 + 8;
  drawText("DESTINATION / COMPLETION", destX, currentY - 18, "/F2", 8, 0.86, 0.15, 0.15);
  drawText(journey.destinationName || (journey.status === "completed" ? "Recorded destination point" : "In transit"), destX, currentY - 32, "/F2", 10, 0.043, 0.122, 0.2);
  drawText(endStr, destX, currentY - 44, "/F1", 8, 0.357, 0.42, 0.498);

  currentY -= 68;

  // 3. Vector Mini-Map Path Overview
  if (journey.points.length >= 2) {
    ensureSpace(120);

    drawText("RECORDED GPS PATH TELEMETRY", marginX, currentY, "/F2", 10, 0.043, 0.122, 0.2);
    currentY -= 10;

    const mapBoxHeight = 85;
    setFillColor(0.97, 0.98, 0.99);
    setStrokeColor(0.85, 0.88, 0.92);
    setLineWidth(1);
    drawRect(marginX, currentY - mapBoxHeight, contentWidth, mapBoxHeight, true, true);

    // Compute bounding box of points
    let minLat = 999, maxLat = -999, minLng = 999, maxLng = -999;
    for (const pt of journey.points) {
      if (pt.latitude < minLat) minLat = pt.latitude;
      if (pt.latitude > maxLat) maxLat = pt.latitude;
      if (pt.longitude < minLng) minLng = pt.longitude;
      if (pt.longitude > maxLng) maxLng = pt.longitude;
    }

    const latSpan = Math.max(0.001, maxLat - minLat);
    const lngSpan = Math.max(0.001, maxLng - minLng);

    const pad = 18;
    const drawW = contentWidth - pad * 2;
    const drawH = mapBoxHeight - pad * 2;
    const mapBaseY = currentY - mapBoxHeight + pad;

    // Background subtle grid
    setStrokeColor(0.91, 0.93, 0.96);
    setLineWidth(0.5);
    for (let i = 1; i <= 3; i++) {
      drawLine(marginX + pad, mapBaseY + (drawH / 4) * i, marginX + contentWidth - pad, mapBaseY + (drawH / 4) * i);
      drawLine(marginX + pad + (drawW / 4) * i, mapBaseY, marginX + pad + (drawW / 4) * i, mapBaseY + drawH);
    }

    // Draw vector path
    setStrokeColor(0.055, 0.486, 0.525);
    setLineWidth(2.2);

    const mappedCoords = journey.points.map((pt) => {
      const normX = (pt.longitude - minLng) / lngSpan;
      const normY = (pt.latitude - minLat) / latSpan;
      return {
        x: marginX + pad + normX * drawW,
        y: mapBaseY + normY * drawH,
      };
    });

    if (mappedCoords.length > 0) {
      currentPageOps.push(`${mappedCoords[0].x.toFixed(2)} ${mappedCoords[0].y.toFixed(2)} m`);
      for (let i = 1; i < mappedCoords.length; i++) {
        currentPageOps.push(`${mappedCoords[i].x.toFixed(2)} ${mappedCoords[i].y.toFixed(2)} l`);
      }
      currentPageOps.push("S");
    }

    // Start Marker (Green Dot)
    setFillColor(0.086, 0.639, 0.29);
    const startPt = mappedCoords[0];
    drawRect(startPt.x - 3.5, startPt.y - 3.5, 7, 7, true, false);

    // End Marker (Red Dot)
    setFillColor(0.86, 0.15, 0.15);
    const endPt = mappedCoords[mappedCoords.length - 1];
    drawRect(endPt.x - 4, endPt.y - 4, 8, 8, true, false);

    // Caption
    drawText("• Start (Green)   • End (Red)   — Real vector path reconstructed from chronological GPS points", marginX + 12, currentY - mapBoxHeight + 5, "/F1", 7.5, 0.357, 0.42, 0.498);

    currentY -= mapBoxHeight + 20;
  } else {
    ensureSpace(45);
    setFillColor(0.98, 0.98, 0.99);
    setStrokeColor(0.89, 0.91, 0.94);
    setLineWidth(1);
    drawRect(marginX, currentY - 32, contentWidth, 32, true, true);
    drawText(
      "No GPS track points recorded during this session (location unavailable or device stationary).",
      marginX + 12,
      currentY - 19,
      "/F3",
      8,
      0.45,
      0.52,
      0.6
    );
    currentY -= 44;
  }

  // 4. Chronological Event Timeline
  ensureSpace(40);
  drawText("CHRONOLOGICAL JOURNEY TIMELINE", marginX, currentY, "/F2", 11, 0.043, 0.122, 0.2);
  currentY -= 15;

  const events = [...journey.events].sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const isLast = i === events.length - 1;
    const evDate = new Date(ev.timestamp);
    const timeStr = evDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    // Calculate height needed for this event
    const itemHeight = ev.details ? 46 : 38;
    ensureSpace(itemHeight + 10);

    const lineX = marginX + 14;
    const dotY = currentY - 5;

    // Timeline connecting line
    if (!isLast) {
      setStrokeColor(0.85, 0.88, 0.92);
      setLineWidth(1.5);
      drawLine(lineX, dotY - 2, lineX, dotY - itemHeight + 6);
    }

    // Timeline Dot colored by event type
    let dotColor = [0.055, 0.486, 0.525]; // default brand
    if (ev.type === "journey_started") dotColor = [0.086, 0.639, 0.29];
    else if (ev.type === "journey_completed") dotColor = [0.86, 0.15, 0.15];
    else if (ev.type === "stop_detected") dotColor = [0.917, 0.345, 0.047];
    else if (ev.type === "journey_resumed") dotColor = [0.145, 0.388, 0.922];
    else if (ev.type === "low_accuracy_warning" || ev.type === "gps_interrupted") dotColor = [0.792, 0.604, 0.016];

    setFillColor(dotColor[0], dotColor[1], dotColor[2]);
    drawRect(lineX - 4, dotY - 4, 8, 8, true, false);

    // Event Title & Timestamp
    const contentX = marginX + 30;
    drawText(timeStr, contentX, currentY, "/F2", 9, 0.055, 0.486, 0.525);
    drawText(`—  ${ev.name}`, contentX + 60, currentY, "/F2", 9.5, 0.043, 0.122, 0.2);

    // Event Location & GPS Coordinates
    const locText = ev.locationName
      ? `${ev.locationName} (${formatCoordinates(ev.latitude, ev.longitude)})`
      : formatCoordinates(ev.latitude, ev.longitude);

    const accText = ev.accuracy ? ` [${formatAccuracy(ev.accuracy)}]` : "";
    drawText(`Location: ${locText}${accText}`, contentX, currentY - 12, "/F1", 8.5, 0.22, 0.28, 0.35);

    if (ev.details) {
      drawText(`Note: ${ev.details}`, contentX, currentY - 23, "/F3", 8, 0.45, 0.52, 0.6);
    }

    currentY -= itemHeight;
  }

  // 5. Data Integrity & Missing Data Notice
  ensureSpace(70);
  currentY -= 10;
  setFillColor(0.98, 0.98, 0.99);
  setStrokeColor(0.89, 0.91, 0.94);
  setLineWidth(1);
  drawRect(marginX, currentY - 48, contentWidth, 48, true, true);

  drawText("TELEMETRY INTEGRITY & COVERAGE DISCLOSURE", marginX + 10, currentY - 14, "/F2", 7.5, 0.357, 0.42, 0.498);
  const integrityNotes = [
    `• GPS Points: ${journey.points.length} coordinates recorded across ${formatDuration(journey.durationSeconds)}.`,
    journey.hasInaccuratePoints
      ? "• Notice: Satellite dilution caused reduced precision on some points; accuracy flags are retained."
      : "• Notice: All captured coordinates met confidence accuracy thresholds.",
    "• Inactivity detection: Stops were recorded automatically based on stationary threshold analysis.",
  ];
  drawText(integrityNotes[0], marginX + 10, currentY - 25, "/F1", 7.5, 0.357, 0.42, 0.498);
  drawText(integrityNotes[1], marginX + 10, currentY - 34, "/F1", 7.5, 0.357, 0.42, 0.498);
  drawText(integrityNotes[2], marginX + 10, currentY - 43, "/F1", 7.5, 0.357, 0.42, 0.498);

  currentY -= 65;

  // Flush last page
  flushPage();

  // --- Draw Footers with Page Numbers on All Pages ---
  const totalPages = pages.length;
  const generatedTimeStr = new Date().toLocaleString();

  for (let p = 0; p < totalPages; p++) {
    const page = pages[p];
    const footerY = 26;
    const dividerY = footerY + 12;

    // Divider line
    page.operations.push("0.890 0.910 0.940 RG 0.75 w");
    page.operations.push(`${marginX.toFixed(2)} ${dividerY.toFixed(2)} m ${(marginX + contentWidth).toFixed(2)} ${dividerY.toFixed(2)} l S`);

    // Disclaimer & Timestamp (Left)
    const safeGen = escapePdfString(`Generated: ${generatedTimeStr} | Personal Safety Record (Not Legally Certified Evidence)`);
    page.operations.push("0.450 0.520 0.600 rg");
    page.operations.push(`BT /F1 7.5 Tf ${marginX.toFixed(2)} ${footerY.toFixed(2)} Td (${safeGen}) Tj ET`);

    // Page Number (Right)
    const pageStr = escapePdfString(`Page ${p + 1} of ${totalPages}`);
    const pageX = marginX + contentWidth - 55;
    page.operations.push(`BT /F2 8 Tf ${pageX.toFixed(2)} ${footerY.toFixed(2)} Td (${pageStr}) Tj ET`);
  }

  // --- Assemble Valid PDF-1.4 Binary Structure ---

  return assemblePdfBinary(pages, pageWidth, pageHeight);
}

function assemblePdfBinary(pages: PageStream[], width: number, height: number): Blob {
  const objects: string[] = [];
  const byteOffsets: number[] = [];

  // Helper to append object and record byte offset
  function addObject(body: string): number {
    const objNum = objects.length + 1;
    objects.push(`${objNum} 0 obj\n${body}\nendobj\n`);
    return objNum;
  }

  // 1. Catalog
  addObject("<< /Type /Catalog /Pages 2 0 R >>");

  // 2. Pages (placeholder updated after creating page objects)
  const pageObjNums: number[] = [];

  // 5, 6, 7. Standard 14 Fonts (built into all PDF readers)
  const fontRegularNum = 5;
  const fontBoldNum = 6;
  const fontObliqueNum = 7;

  // We will build page objects and contents
  // Let's reserve objects 2 (Pages), 3.. for pages
  // To keep indexing clean, create fonts first:
  // Font 1: Helvetica
  // Font 2: Helvetica-Bold
  // Font 3: Helvetica-Oblique

  const pdfParts: string[] = [];
  pdfParts.push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  // Obj 1: Catalog
  // Obj 2: Pages container
  // Obj 3: Font /F1 Helvetica
  // Obj 4: Font /F2 Helvetica-Bold
  // Obj 5: Font /F3 Helvetica-Oblique
  // Obj 6+: Page objects & Content stream objects

  const f1Num = 3;
  const f2Num = 4;
  const f3Num = 5;

  const pageTreeKids: string[] = [];
  let nextObjNum = 6;

  const pageEntries: { pageNum: number; contentNum: number }[] = [];

  for (let i = 0; i < pages.length; i++) {
    const pageNum = nextObjNum++;
    const contentNum = nextObjNum++;
    pageTreeKids.push(`${pageNum} 0 R`);
    pageEntries.push({ pageNum, contentNum });
  }

  // Build Object text table
  const objList: { num: number; content: string }[] = [];

  // 1. Catalog
  objList.push({ num: 1, content: "<< /Type /Catalog /Pages 2 0 R >>" });

  // 2. Pages
  objList.push({
    num: 2,
    content: `<< /Type /Pages /Kids [${pageTreeKids.join(" ")}] /Count ${pages.length} >>`,
  });

  // 3. Fonts
  objList.push({ num: f1Num, content: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>" });
  objList.push({ num: f2Num, content: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>" });
  objList.push({ num: f3Num, content: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>" });

  // Page Objects & Content Streams
  for (let i = 0; i < pages.length; i++) {
    const entry = pageEntries[i];
    const streamContent = pages[i].operations.join("\n");
    const streamLength = new TextEncoder().encode(streamContent).length;

    // Page object
    objList.push({
      num: entry.pageNum,
      content: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${entry.contentNum} 0 R /Resources << /Font << /F1 ${f1Num} 0 R /F2 ${f2Num} 0 R /F3 ${f3Num} 0 R >> >> >>`,
    });

    // Content stream object
    objList.push({
      num: entry.contentNum,
      content: `<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream`,
    });
  }

  // Write out all objects and compute precise byte offsets
  let currentByteOffset = new TextEncoder().encode(pdfParts[0]).length;
  const offsets: number[] = [0]; // index 0 unused

  for (const obj of objList) {
    offsets[obj.num] = currentByteOffset;
    const str = `${obj.num} 0 obj\n${obj.content}\nendobj\n`;
    pdfParts.push(str);
    currentByteOffset += new TextEncoder().encode(str).length;
  }

  // Cross Reference Table
  const startXref = currentByteOffset;
  const totalObjCount = objList.length + 1;
  let xrefStr = `xref\n0 ${totalObjCount}\n0000000000 65535 f \n`;

  for (let i = 1; i < totalObjCount; i++) {
    const offset = offsets[i] || 0;
    xrefStr += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }

  xrefStr += `trailer\n<< /Size ${totalObjCount} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
  pdfParts.push(xrefStr);

  return new Blob(pdfParts, { type: "application/pdf" });
}

export const generateJourneyPdf = generateJourneyPdfBlob;
