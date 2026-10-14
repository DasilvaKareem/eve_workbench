/** Conservative word wrapping for a spatial text surface with a fixed font size. */
export function paginatePanelText(text: string, columns = 42, linesPerPage = 8): string[] {
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(linesPerPage) || linesPerPage < 1) {
    throw new RangeError('Panel page dimensions must be positive integers.');
  }
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const characters = Array.from(paragraph.replace(/\t/g, '  '));
    if (!characters.length) { lines.push(''); continue; }
    let offset = 0;
    while (characters.length - offset > columns) {
      let cut = characters.slice(offset, offset + columns + 1).lastIndexOf(' ');
      if (cut < columns / 2) cut = columns;
      lines.push(characters.slice(offset, offset + cut).join(''));
      offset += cut;
      if (characters[offset] === ' ') offset++;
    }
    if (offset < characters.length) lines.push(characters.slice(offset).join(''));
  }
  const pages: string[] = [];
  for (let offset = 0; offset < lines.length; offset += linesPerPage) pages.push(lines.slice(offset, offset + linesPerPage).join('\n'));
  return pages.length ? pages : [''];
}
