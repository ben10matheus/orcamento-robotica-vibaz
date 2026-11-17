/* Editable Word export for the VIBAZ proposal. Requires vendor/docx.umd.js. */
(function (global) {
  'use strict';

  const PAGE = { width: 11906, height: 16838, side: 720 };
  const CONTENT = PAGE.width - PAGE.side * 2;
  const PIXELS = CONTENT / 15;
  const OMIT = '.head,.footer,.no-print,.dropzone,.imgremove,.hide-when-auto,script,style,button,input[type="file"],[hidden]';
  const BLOCKS = new Set(['DIV', 'SECTION', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'FIGURE', 'BLOCKQUOTE']);

  function color(value) {
    if (!value || value === 'transparent') return undefined;
    const rgb = value.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
    return rgb ? rgb.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase() : undefined;
  }

  function omit(element) {
    return element.matches(OMIT) || getComputedStyle(element).display === 'none';
  }

  function cleanText(value, preserve) {
    return preserve ? value.replace(/\r\n?/g, '\n') : value.replace(/[\t\r\n ]+/g, ' ');
  }

  function runStyle(element, overrides) {
    const style = getComputedStyle(element);
    return Object.assign({
      font: 'Arial',
      size: Math.round(Math.max(16, Math.min(32, (parseFloat(style.fontSize) || 14) * 1.5))),
      bold: Number(style.fontWeight) >= 600 || style.fontWeight === 'bold',
      italics: style.fontStyle === 'italic',
      color: color(style.color) || '0E1222',
      ...(style.textDecorationLine.includes('underline') ? { underline: {} } : {}),
    }, overrides || {});
  }

  function paragraphStyle(element, extra) {
    const style = getComputedStyle(element);
    const alignment = { left: 'left', right: 'right', center: 'center', justify: 'both', start: 'left', end: 'right' }[style.textAlign] || 'left';
    return Object.assign({
      alignment,
      spacing: {
        before: Math.min(260, Math.max(0, (parseFloat(style.marginTop) || 0) * 10)),
        after: Math.min(180, Math.max(60, (parseFloat(style.marginBottom) || 0) * 10)),
        line: 264,
      },
      widowControl: true,
    }, extra || {});
  }

  global.VibazWordExport = async function (pages, filename) {
    const d = global.docx;
    if (!d || !d.Document || !d.Packer) throw new Error('A biblioteca de exportação Word não foi carregada. Atualize a página e tente novamente.');
    const sourcePages = Array.from(pages || []);
    if (!sourcePages.length) throw new Error('Nenhuma página da proposta está disponível para exportação.');
    const cache = new Map();

    async function imageData(element) {
      const source = element.currentSrc || element.src;
      if (!source) throw new Error('Uma imagem da proposta está sem endereço.');
      if (!cache.has(source)) cache.set(source, (async () => {
        try {
          if (!element.complete && element.decode) await element.decode();
          const response = await fetch(source);
          if (!response.ok) throw new Error('HTTP ' + response.status);
          let data = new Uint8Array(await response.arrayBuffer());
          let type = data[0] === 0x89 && data[1] === 0x50 ? 'png' : data[0] === 0xFF && data[1] === 0xD8 ? 'jpg' : null;
          let width = element.naturalWidth;
          let height = element.naturalHeight;
          if (!width || !height) {
            const decoded = new Image();
            decoded.src = source;
            await decoded.decode();
            width = decoded.naturalWidth;
            height = decoded.naturalHeight;
          }
          if (!type) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(element, 0, 0, width, height);
            const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!png) throw new Error('Não foi possível converter o formato da imagem.');
            data = new Uint8Array(await png.arrayBuffer());
            type = 'png';
          }
          return { data, type, width, height };
        } catch (error) {
          throw new Error('Não foi possível incorporar a imagem “' + (element.alt || source.split('/').pop().slice(0, 70)) + '” no Word: ' + error.message);
        }
      })());
      return cache.get(source);
    }

    async function imageRun(element, maxWidth, maxHeight, ctx, forceWidth) {
      const img = await imageData(element);
      const rect = element.getBoundingClientRect();
      const desired = forceWidth ? maxWidth : Math.min(maxWidth, (rect.width || img.width) * ctx.scale);
      const scale = Math.min(desired / img.width, (maxHeight || 650) / img.height);
      return new d.ImageRun({
        data: img.data, type: img.type,
        transformation: { width: Math.max(1, img.width * scale), height: Math.max(1, img.height * scale) },
        altText: { title: element.alt || 'Imagem da proposta', description: element.alt || 'Imagem da proposta', name: element.alt || 'Imagem' },
      });
    }

    async function inline(node, ctx, overrides) {
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        const preserve = /pre|break-spaces/.test(getComputedStyle(parent).whiteSpace);
        const text = cleanText(node.nodeValue || '', preserve);
        return text ? [new d.TextRun({ text, ...runStyle(parent, overrides) })] : [];
      }
      if (node.nodeType !== Node.ELEMENT_NODE || omit(node)) return [];
      if (node.tagName === 'BR') return [new d.TextRun({ break: 1 })];
      if (node.tagName === 'IMG') return [await imageRun(node, ctx.width / 15, 600, ctx)];
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)) return [new d.TextRun({ text: node.value || '', ...runStyle(node, overrides) })];
      const runs = [];
      for (const child of node.childNodes) runs.push(...await inline(child, ctx, overrides));
      if (BLOCKS.has(node.tagName) && node.nextSibling && (node.nextSibling.textContent || '').trim()) runs.push(new d.TextRun({ break: 1 }));
      return runs;
    }

    function trimRuns(runs) {
      // Runs retain inline formatting; ordinary HTML whitespace is collapsed by inline().
      return runs;
    }

    async function paragraph(element, ctx, extra, overrides) {
      const runs = [];
      for (const node of element.childNodes) runs.push(...await inline(node, ctx, overrides));
      return new d.Paragraph({ ...paragraphStyle(element), ...(extra || {}), children: trimRuns(runs) });
    }

    function emptyParagraph() {
      return new d.Paragraph({ children: [], spacing: { before: 0, after: 0, line: 40 }, run: { size: 2 } });
    }

    async function childBlocks(element, ctx) {
      const output = [];
      let runs = [];
      async function flush() {
        if (runs.length) output.push(new d.Paragraph({ ...paragraphStyle(element), children: runs }));
        runs = [];
      }
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          if ((node.nodeValue || '').trim() || runs.length) runs.push(...await inline(node, ctx));
        } else if (node.nodeType === Node.ELEMENT_NODE && !omit(node)) {
          if (BLOCKS.has(node.tagName) || node.matches('.preview,.capa,.itemcard,.sigs,.grid-1,.grid-2')) {
            await flush();
            output.push(...await blocks(node, ctx));
          } else runs.push(...await inline(node, ctx));
        }
      }
      await flush();
      return output;
    }

    async function formFields(element, ctx) {
      const output = [];
      for (const label of element.querySelectorAll('label')) {
        if (omit(label)) continue;
        const values = Array.from(label.parentElement.children).filter(el => el !== label && !omit(el));
        const runs = [new d.TextRun({ text: label.textContent.trim() + ': ', bold: true, size: 19, font: 'Arial' })];
        for (const value of values) runs.push(...await inline(value, ctx, { size: 19 }));
        output.push(new d.Paragraph({ children: runs, spacing: { after: 85, line: 240 } }));
      }
      return output;
    }

    const border = { style: 'single', size: 4, color: 'D9D9D9' };
    const borders = { top: border, bottom: border, left: border, right: border };
    const noBorder = { style: 'nil', size: 0, color: 'FFFFFF' };
    const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

    async function htmlTable(element, ctx) {
      const htmlRows = Array.from(element.querySelectorAll('tr')).filter(row => row.closest('table') === element && !omit(row));
      if (!htmlRows.length) return [];
      const columns = Math.max(...htmlRows.map(row => Array.from(row.children).reduce((n, cell) => n + (cell.colSpan || 1), 0)));
      let widths = Array(columns).fill(ctx.width / columns);
      if (element.matches('.tbl5') && columns === 4) widths = [0.50, 0.08, 0.20, 0.22].map(n => Math.round(ctx.width * n));
      const rows = [];
      for (const row of htmlRows) {
        const header = row.parentElement.tagName === 'THEAD';
        const footer = row.parentElement.tagName === 'TFOOT';
        const cells = [];
        let column = 0;
        for (const cell of row.children) {
          if (!/^(TH|TD)$/.test(cell.tagName) || omit(cell)) continue;
          const span = cell.colSpan || 1;
          const width = widths.slice(column, column + span).reduce((a, b) => a + b, 0);
          const children = await childBlocks(cell, { ...ctx, width: Math.max(400, width - 180) });
          cells.push(new d.TableCell({
            children: children.length ? children : [emptyParagraph()],
            width: { size: width, type: 'dxa' }, columnSpan: span,
            margins: { top: 90, bottom: 90, left: 90, right: 90 }, borders,
            verticalAlign: 'center',
            shading: { fill: header ? 'EEF2FF' : footer ? 'F6F7FB' : 'FFFFFF' },
          }));
          column += span;
        }
        rows.push(new d.TableRow({ children: cells, tableHeader: header, cantSplit: row.getBoundingClientRect().height * ctx.scale < 600 }));
      }
      return [new d.Table({
        rows, width: { size: ctx.width, type: 'dxa' }, columnWidths: widths,
        layout: 'fixed', borders: { ...borders, insideHorizontal: border, insideVertical: border },
      }), emptyParagraph()];
    }

    async function imageGrid(element, ctx) {
      const images = Array.from(element.querySelectorAll('img')).filter(img => !omit(img) && !img.closest(OMIT));
      if (!images.length) return [];
      const columns = 2;
      const width = Math.floor(ctx.width / columns);
      const rows = [];
      for (let index = 0; index < images.length; index += columns) {
        const cells = [];
        for (let offset = 0; offset < columns; offset++) {
          const image = images[index + offset];
          cells.push(new d.TableCell({
            width: { size: width, type: 'dxa' }, borders: noBorders,
            margins: { top: 70, bottom: 70, left: 70, right: 70 },
            children: image ? [new d.Paragraph({
              children: [await imageRun(image, (width - 140) / 15, 280, ctx)],
              alignment: 'center', spacing: { after: 0, before: 0 },
            })] : [emptyParagraph()],
          }));
        }
        rows.push(new d.TableRow({ children: cells, cantSplit: true }));
      }
      return [new d.Table({ rows, width: { size: ctx.width, type: 'dxa' }, columnWidths: [width, width], layout: 'fixed', borders: { ...noBorders, insideHorizontal: noBorder, insideVertical: noBorder } }), emptyParagraph()];
    }

    async function itemCard(element, ctx) {
      const image = element.querySelector('.itemimg img');
      if (!image || omit(image)) return childBlocks(element, ctx);
      const imageWidth = Math.round(ctx.width * 0.25);
      const textWidth = ctx.width - imageWidth;
      const text = [];
      for (const node of element.children) if (!node.matches('.itemimg')) text.push(...await blocks(node, { ...ctx, width: textWidth - 180 }));
      return [new d.Table({
        width: { size: ctx.width, type: 'dxa' }, columnWidths: [imageWidth, textWidth], layout: 'fixed',
        borders: { ...noBorders, insideHorizontal: noBorder, insideVertical: noBorder },
        rows: [new d.TableRow({ children: [
          new d.TableCell({ width: { size: imageWidth, type: 'dxa' }, borders: noBorders, margins: { top: 60, bottom: 60, left: 60, right: 120 }, children: [new d.Paragraph({ children: [await imageRun(image, (imageWidth - 180) / 15, 145, ctx)], alignment: 'center' })] }),
          new d.TableCell({ width: { size: textWidth, type: 'dxa' }, borders: noBorders, margins: { top: 60, bottom: 60, left: 60, right: 60 }, children: text.length ? text : [emptyParagraph()] }),
        ] })],
      }), emptyParagraph()];
    }

    async function signatures(element, ctx) {
      const cards = Array.from(element.children).filter(card => !omit(card));
      if (!cards.length) return [];
      const width = Math.floor(ctx.width / cards.length);
      const cells = [];
      for (const card of cards) cells.push(new d.TableCell({
        width: { size: width, type: 'dxa' }, borders,
        margins: { top: 100, bottom: 100, left: 100, right: 100 },
        children: [await paragraph(card, { ...ctx, width: width - 200 }, { spacing: { after: 0, line: 220 } }, { size: 16 })],
      }));
      return [new d.Table({ rows: [new d.TableRow({ children: cells, cantSplit: true })], width: { size: ctx.width, type: 'dxa' }, columnWidths: cards.map(() => width), layout: 'fixed', borders: { ...borders, insideHorizontal: border, insideVertical: border } }), emptyParagraph()];
    }

    async function list(element, ctx, depth) {
      const output = [];
      const level = Math.min(depth || 0, 8);
      for (const item of element.children) {
        if (item.tagName !== 'LI' || omit(item)) continue;
        const runs = [];
        for (const child of item.childNodes) if (!(child.nodeType === 1 && /^(UL|OL)$/.test(child.tagName))) runs.push(...await inline(child, ctx));
        output.push(new d.Paragraph({
          children: runs, spacing: { after: 80, line: 264 }, widowControl: true,
          ...(element.tagName === 'OL' ? { numbering: { reference: 'vibaz-numbered', level } } : { bullet: { level } }),
        }));
        for (const child of item.children) if (/^(UL|OL)$/.test(child.tagName)) output.push(...await list(child, ctx, level + 1));
      }
      return output;
    }

    async function blocks(element, ctx) {
      if (omit(element)) return [];
      if (element.matches('.grid-1,.grid-2') && element.querySelector('label')) return formFields(element, ctx);
      if (element.tagName === 'TABLE') return htmlTable(element, ctx);
      if (element.matches('.preview')) return imageGrid(element, ctx);
      if (element.matches('.itemcard')) return itemCard(element, ctx);
      if (element.matches('.sigs')) return signatures(element, ctx);
      if (/^(UL|OL)$/.test(element.tagName)) return list(element, ctx, 0);
      if (element.matches('.capa')) {
        const images = Array.from(element.querySelectorAll('img')).filter(img => !omit(img));
        const output = [];
        for (const image of images) output.push(new d.Paragraph({ children: [await imageRun(image, ctx.width / 15, 260, ctx)], alignment: 'center', spacing: { before: 130, after: 130 } }));
        return output;
      }
      if (/^H[1-6]$/.test(element.tagName)) {
        const level = Number(element.tagName[1]);
        return [await paragraph(element, ctx, { heading: level === 1 ? 'Title' : level === 2 ? 'Heading1' : 'Heading2', keepNext: true, spacing: { before: level === 1 ? 100 : 180, after: 120, line: 280 } }, { bold: true, color: '000000', ...(level === 1 ? { size: 27, underline: undefined } : {}) })];
      }
      if (element.tagName === 'P' || element.matches('.itemname,.meta,.subttl,.frase,.note')) return [await paragraph(element, ctx)];
      if (element.tagName === 'IMG') return [new d.Paragraph({ children: [await imageRun(element, ctx.width / 15, 600, ctx)], spacing: { before: 80, after: 80 } })];
      return childBlocks(element, ctx);
    }

    const sections = [];
    for (const page of sourcePages) {
      const rect = page.getBoundingClientRect();
      const ctx = { width: CONTENT, scale: PIXELS / (rect.width || 794) };
      const headerImage = page.querySelector('.head img');
      const footerImage = page.querySelector('.footer .rodapeimg img');
      const headerChildren = [];
      let headerHeight = 0;
      if (headerImage) {
        const img = await imageData(headerImage);
        headerHeight = PIXELS * img.height / img.width;
        headerChildren.push(new d.Paragraph({ children: [await imageRun(headerImage, PIXELS, 160, ctx, true)], spacing: { before: 0, after: 0, line: 240 } }));
      }
      const footerChildren = [];
      let footerHeight = 0;
      if (footerImage) {
        const img = await imageData(footerImage);
        footerHeight = PIXELS * img.height / img.width;
        footerChildren.push(new d.Paragraph({ children: [await imageRun(footerImage, PIXELS, 120, ctx, true)], spacing: { before: 0, after: 0, line: 240 } }));
      }
      footerChildren.push(new d.Paragraph({
        alignment: 'right', spacing: { before: 20, after: 0, line: 200 },
        children: [new d.TextRun({ text: 'Página ', size: 16, font: 'Arial' }), new d.TextRun({ children: [d.PageNumber.CURRENT], size: 16 }), new d.TextRun({ text: ' de ', size: 16, font: 'Arial' }), new d.TextRun({ children: [d.PageNumber.TOTAL_PAGES], size: 16 })],
      }));
      const children = await childBlocks(page, ctx);
      sections.push({
        properties: {
          type: d.SectionType.NEXT_PAGE,
          page: {
            size: { width: PAGE.width, height: PAGE.height },
            margin: { top: Math.max(480, Math.round(headerHeight * 15 + 120)), bottom: Math.max(720, Math.round(footerHeight * 15 + 330)), left: PAGE.side, right: PAGE.side, header: 0, footer: 100 },
          },
        },
        headers: headerChildren.length ? { default: new d.Header({ children: headerChildren }) } : undefined,
        footers: { default: new d.Footer({ children: footerChildren }) },
        children: children.length ? children : [emptyParagraph()],
      });
    }
    const document = new d.Document({
      creator: 'VIBAZ', title: (filename || 'Proposta técnica comercial').replace(/\.docx$/i, ''),
      description: 'Proposta técnica comercial editável',
      styles: { default: { document: { run: { font: 'Arial', size: 20, color: '0E1222' }, paragraph: { spacing: { after: 100, line: 264 } } } } },
      numbering: { config: [{ reference: 'vibaz-numbered', levels: Array.from({ length: 9 }, (_, level) => ({ level, format: 'decimal', text: '%' + (level + 1) + '.', alignment: 'left', style: { paragraph: { indent: { left: 360 + level * 360, hanging: 260 } } } })) }] },
      sections,
    });
    return d.Packer.toBlob(document);
  };
})(window);
