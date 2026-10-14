import ExcelJS from 'exceljs';

// Shared by every .xlsx export in the app (Employees, Insights) — the
// bold/tinted header row and the writeBuffer()->Buffer conversion were
// duplicated verbatim in each service before this. Found in the 2026-10
// repeat/unused audit.
export function styleHeaderRow(sheet: ExcelJS.Worksheet) {
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4F5' } };
}

export async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
