/* Exportação local da proposta. Bibliotecas carregadas apenas ao exportar. */
(function () {
  'use strict';
  const status = document.getElementById('exportStatus');
  const buttons = ['btnPrintAll', 'btnExportPDF', 'btnExportWord'].map(id => document.getElementById(id));
  const loaded = new Map();

  const style = document.createElement('style');
  style.textContent = `
    .export-actions{flex-wrap:wrap;align-items:center}
    .export-actions .btn:disabled{opacity:.6;cursor:wait}
    #exportStatus{flex-basis:100%;text-align:center;font-size:13px}
    #proposal-export-stage{position:absolute;left:-10000px;top:0;width:210mm;background:white;color:#0e1222;pointer-events:none}
    #proposal-export-stage .export-page{width:210mm;height:297mm;margin:0;border:0;box-shadow:none;background:white}
    #proposal-export-stage .export-field{display:block;white-space:pre-wrap;overflow-wrap:anywhere;border:0;border-radius:0;padding:7px 9px;background:transparent;min-height:20px;box-sizing:border-box;width:100%}
    #proposal-export-stage [contenteditable]{overflow-wrap:anywhere}
    #proposal-export-stage .writebox:empty:before{content:none}
    #proposal-export-stage .imgcard{border:none}
  `;
  document.head.appendChild(style);

  function loadScript(path, ready) {
    if (ready()) return Promise.resolve();
    if (!loaded.has(path)) {
      const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = path;
        script.onload = () => ready() ? resolve() : reject(new Error('Biblioteca de exportação indisponível.'));
        script.onerror = () => { script.remove(); reject(new Error('Não foi possível carregar os arquivos de exportação. Tente novamente.')); };
        document.head.appendChild(script);
      });
      loaded.set(path, promise);
      promise.catch(() => loaded.delete(path));
    }
    return loaded.get(path);
  }

  function validateName() {
    for (const [id, label] of [['cliOrc', 'o número da proposta no campo Orçamento'], ['cliEmpresa', 'o nome do cliente no campo Empresa']]) {
      const field = document.getElementById(id);
      if (!field.value.trim()) {
        status.textContent = `Preencha ${label} antes de gerar o arquivo.`;
        field.scrollIntoView({block:'center', behavior:'smooth'});
        field.focus({preventScroll:true});
        return false;
      }
    }
    return true;
  }

  async function waitForImages(root) {
    await Promise.all([...root.querySelectorAll('img')].map(async img => {
      // O catálogo pode tentar outras URLs no onerror antes de encontrar a foto.
      const started = Date.now();
      while (getComputedStyle(img).display !== 'none' && img.getClientRects().length) {
        if (img.complete && img.naturalWidth) return;
        if (Date.now() - started > 20000) throw new Error('Uma imagem da proposta não pôde ser carregada. Aguarde e tente novamente.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }));
  }

  function clonePages() {
    const stage = document.createElement('div');
    stage.id = 'proposal-export-stage';
    stage.setAttribute('aria-hidden', 'true');
    const sources = [...document.querySelectorAll('body > .page')];
    const pages = sources.map(source => {
      const clone = source.cloneNode(true);
      clone.classList.add('export-page');
      clone.classList.remove('page-auto');
      const originals = source.querySelectorAll('input, textarea, select');
      clone.querySelectorAll('input, textarea, select').forEach((field, i) => {
        if (field.type === 'file') { field.remove(); return; }
        const text = document.createElement('span');
        text.className = 'export-field';
        text.textContent = originals[i].value;
        field.replaceWith(text);
      });
      clone.querySelectorAll('.no-print, .dropzone, .imgremove, .hide-when-auto, button, script, [hidden]').forEach(el => el.remove());
      clone.querySelectorAll('[contenteditable]').forEach(el => el.setAttribute('contenteditable', 'false'));
      stage.appendChild(clone);
      return clone;
    });
    document.body.appendChild(stage);
    return {stage, pages};
  }

  async function makePDF(pages, filename) {
    const pdf = new window.jspdf.jsPDF({orientation:'portrait', unit:'mm', format:'a4', compress:true});
    pdf.setProperties({title:filename, author:'VIBAZ', subject:'Proposta técnica comercial'});
    for (let i = 0; i < pages.length; i++) {
      status.textContent = `Gerando PDF: página ${i + 1} de ${pages.length}…`;
      const canvas = await window.html2canvas(pages[i], {
        scale:2, backgroundColor:'#ffffff', useCORS:true, logging:false,
        windowWidth:1280, windowHeight:1200, scrollX:0, scrollY:0,
        onclone: doc => { doc.querySelectorAll('img').forEach(img => { img.loading = 'eager'; }); }
      });
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', .95), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      canvas.width = 0;
      canvas.height = 0;
    }
    return pdf.output('blob');
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function exportProposal(format) {
    if (window.vibazExportInProgress || !validateName()) return;
    window.vibazExportInProgress = true;
    buttons.forEach(button => { button.disabled = true; });
    status.textContent = `Preparando ${format === 'pdf' ? 'PDF' : 'Word'}…`;
    let stage;
    try {
      if (format === 'pdf') {
        await Promise.all([
          loadScript('vendor/html2canvas.min.js', () => typeof window.html2canvas === 'function'),
          loadScript('vendor/jspdf.umd.min.js', () => !!window.jspdf?.jsPDF)
        ]);
      } else {
        await loadScript('vendor/docx.umd.js', () => !!window.docx?.Packer);
        await loadScript('word-export.js', () => typeof window.VibazWordExport === 'function');
      }
      if (document.fonts?.ready) await document.fonts.ready;
      await waitForImages(document.querySelector('body'));
      // Finaliza a paginação antes da captura, incluindo a última edição feita.
      window.vibazExportInProgress = false;
      window.prepareProposalForExport?.();
      window.vibazExportInProgress = true;
      if (!validateName()) return;
      const filename = getProposalFileBaseName();
      const cloned = clonePages();
      stage = cloned.stage;
      await waitForImages(stage);
      const blob = format === 'pdf' ? await makePDF(cloned.pages, filename) : await window.VibazWordExport(cloned.pages, filename);
      const extension = format === 'pdf' ? 'pdf' : 'docx';
      download(blob, `${filename}.${extension}`);
      status.textContent = `Arquivo gerado: ${filename}.${extension}`;
    } catch (error) {
      console.error('Falha ao exportar proposta:', error);
      status.textContent = `Não foi possível gerar o arquivo. ${error.message || 'Tente novamente.'}`;
    } finally {
      stage?.remove();
      window.vibazExportInProgress = false;
      buttons.forEach(button => { button.disabled = false; });
    }
  }
  document.getElementById('btnExportPDF').addEventListener('click', () => exportProposal('pdf'));
  document.getElementById('btnExportWord').addEventListener('click', () => exportProposal('word'));
})();
