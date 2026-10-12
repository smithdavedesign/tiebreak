// CSV for spreadsheets (RFC 4180): CRLF rows, quoted cells where needed, and a
// byte-order mark so Excel reads UTF-8. Text cells a spreadsheet would run as
// a formula get a leading ' (OWASP's CSV-injection guard): poll options are
// user input, and the export is opened in Excel or Sheets.
export type Cell = string | number | null

const BOM = String.fromCharCode(0xfeff)
const FORMULA_START = /^[=+\-@\t\r]/
const NEEDS_QUOTES = /[",\r\n]/

export function csvCell(value: Cell): string {
  if (value === null) return ''
  let text = String(value)
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toCsv(rows: Cell[][]): string {
  return BOM + rows.map((row) => row.map(csvCell).join(',') + '\r\n').join('')
}
