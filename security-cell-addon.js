/*
 * Addon: Célula de Segurança para o fluxo “Fechar Orçamento”
 * Autor: ChatGPT (GPT-5 Thinking)
 * Uso:
 *  1) Importe ESTE arquivo após seus scripts principais (no final do <body>):
 *     <script src="js/security-cell-addon.js"></script>
 *  2) Chame uma vez após o DOM carregar:
 *     SecurityCellAddon.mount({
 *        fecharSelector: '#fecharOrcamento', // botão existente “Fechar orçamento”
 *        onProceed: () => {                   // o que hoje acontece ao fechar
 *          // Chame aqui sua função atual de fechamento
 *          // Ex.: finalizarOrcamento(); ou document.querySelector('#fecharOrcamento').dataset.nativeClick();
 *          if (typeof finalizarOrcamento === 'function') finalizarOrcamento();
 *        },
 *        onAttachToCart: (total) => {
 *          // OPCIONAL: como anexar o item “célula de segurança” ao seu carrinho/ proposta
 *          // Ajuste para sua estrutura. Abaixo há estratégias de fallback.
 *          SecurityCellAddon.defaultAttach(total);
 *        }
 *     });
 *
 *  3) Se preferir, em vez de onProceed/onAttachToCart, você pode escutar o evento:
 *        window.addEventListener('securitycell:added', (ev) => {
 *           console.log('Total célula de segurança:', ev.detail.total);
 *        });
 *
 *  Observações:
 *   - O addon injeta o modal via JS e CSS (nenhum HTML extra é necessário).
 *   - Preços em BRL. Arredondamento para 2 casas. Formatação locale pt-BR.
 */

(function(){
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const ITENS = [
    { key:'SECAO_BIOMBO_12x2', nome:'SEÇÃO BIOMBO 1,2×2 m', preco: 2473.42 },
    { key:'BARREIRA_LUZ_1_7', nome:'BARREIRA DE LUZ 1,7 m', preco: 27207.60 },
    { key:'BARREIRA_LUZ_1', nome:'BARREIRA DE LUZ 1 m', preco: 18138.40 },
    { key:'SEMAFORO_4_CORES', nome:'SEMAFARO 4 CORES', preco: 824.47 },
    { key:'FECHADURA_SEG', nome:'FECHADURA SEGURANÇA/SENSOR', preco: 10718.14 },
    { key:'BOTOEIRA_BIMANUAL', nome:'BOTOEIRA BIMANUAL', preco: 9069.20 },
    { key:'CLP_PROG', nome:'CLP PROGRAMAÇÃO', preco: 15664.98 },
    { key:'CLP_SEG', nome:'CLP SEGURANÇA', preco: 11377.72 },
    { key:'RELE_SEG', nome:'RELÊ DE SEGURANÇA', preco: 3297.89 },
    { key:'CABEAMENTO', nome:'CABEAMENTO/CONECTORES', preco: 16489.45 },
  ];

  const styles = `
  .sc-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999}
  .sc-card{width:min(940px,94vw);background:#0e1116;color:#eaeef5;border:1px solid #1f2937;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
  .sc-h{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #1f2937}
  .sc-h h3{margin:0;font-size:18px;font-weight:600}
  .sc-x{cursor:pointer;border:0;background:transparent;color:#9aa4b2;font-size:18px}
  .sc-b{padding:18px 22px}
  .sc-q{display:flex;gap:10px;margin-top:8px}
  .sc-btn{padding:10px 14px;border-radius:10px;border:1px solid #334155;cursor:pointer;background:#111827;color:#eaeef5}
  .sc-btn.primary{background:#16a34a;border-color:#15803d}
  .sc-btn.ghost{background:transparent}
  .sc-grid{margin-top:16px;border:1px solid #1f2937;border-radius:12px;overflow:hidden}
  .sc-row{display:grid;grid-template-columns:1fr 140px 140px 160px;gap:0;border-top:1px solid #1f2937}
  .sc-row.h{background:#0b0f14;font-weight:600}
  .sc-cell{padding:12px 14px;font-size:14px}
  .sc-input{width:100%;padding:8px 10px;border-radius:8px;border:1px solid #334155;background:#0b0f14;color:#eaeef5}
  .sc-foot{display:flex;align-items:center;justify-content:space-between;margin-top:16px}
  .sc-total{font-size:16px;font-weight:700}
  .sc-help{font-size:12px;color:#93a3b8}
  @media (max-width:720px){
    .sc-row{grid-template-columns:1fr 110px 110px 120px}
    .sc-cell{padding:10px 12px;font-size:13px}
  }
  `;

  function injectCSS(){
    if(document.getElementById('security-cell-addon-css')) return;
    const s = document.createElement('style');
    s.id='security-cell-addon-css';
    s.textContent = styles;
    document.head.appendChild(s);
  }

  function el(html){
    const div=document.createElement('div');
    div.innerHTML=html.trim();
    return div.firstElementChild;
  }

  function buildModal(){
    const mask = el(`<div class="sc-modal-mask" role="dialog" aria-modal="true" style="display:none"></div>`);
    const card = el(`<div class="sc-card"></div>`); mask.appendChild(card);
    const header = el(`<div class="sc-h"><h3>Adicionar célula de segurança?</h3><button class="sc-x" aria-label="Fechar">✕</button></div>`);
    const body = el(`<div class="sc-b"></div>`);

    const ask = el(`<div>
        <p>Você deseja adicionar os itens de <strong>célula de segurança</strong> ao orçamento?</p>
        <div class="sc-q">
          <button class="sc-btn" data-action="no">Não, continuar</button>
          <button class="sc-btn primary" data-action="yes">Sim, escolher itens</button>
        </div>
      </div>`);

    const listWrap = el(`<div style="display:none"></div>`);

    const grid = el(`<div class="sc-grid"></div>`);
    const head = el(`<div class="sc-row h">
        <div class="sc-cell">Item</div>
        <div class="sc-cell">Preço unit.</div>
        <div class="sc-cell">Qtd.</div>
        <div class="sc-cell">Subtotal</div>
      </div>`);
    grid.appendChild(head);

    const inputs = new Map();

    ITENS.forEach(it => {
      const row = el(`<div class="sc-row" data-key="${it.key}"></div>`);
      row.appendChild(el(`<div class="sc-cell">${it.nome}</div>`));
      row.appendChild(el(`<div class="sc-cell">${BRL.format(it.preco)}</div>`));
      const qtdCell = el(`<div class="sc-cell"></div>`);
      const input = el(`<input class="sc-input" type="number" inputmode="numeric" min="0" step="1" value="0" aria-label="Quantidade ${it.nome}">`);
      qtdCell.appendChild(input);
      row.appendChild(qtdCell);
      const sub = el(`<div class="sc-cell" data-subtotal>R$ 0,00</div>`);
      row.appendChild(sub);
      inputs.set(it.key, { input, sub, it });
      grid.appendChild(row);
    });

    const foot = el(`<div class="sc-foot">
        <div class="sc-help">Dica: deixe 0 nos itens que não deseja incluir.</div>
        <div class="sc-total">Total: <span id="sc-total">R$ 0,00</span></div>
      </div>`);

    const actions = el(`<div style="display:flex;gap:10px;margin-top:14px;justify-content:flex-end">
        <button class="sc-btn ghost" data-action="back">Voltar</button>
        <button class="sc-btn primary" data-action="continue">Continuar</button>
      </div>`);

    listWrap.appendChild(grid); listWrap.appendChild(foot); listWrap.appendChild(actions);

    body.appendChild(ask);
    body.appendChild(listWrap);

    card.appendChild(header);
    card.appendChild(body);

    // lógica
    function calc(){
      let total = 0;
      inputs.forEach(({input, sub, it})=>{
        const q = Math.max(0, parseInt(input.value||'0',10));
        const st = q * it.preco;
        sub.textContent = BRL.format(st);
        total += st;
      });
      body.querySelector('#sc-total').textContent = BRL.format(total);
      return total;
    }

    inputs.forEach(({input})=> input.addEventListener('input', calc));

    const api = {
      open(){ mask.style.display='flex'; calc(); },
      close(){ mask.style.display='none'; },
      showAsk(){ ask.style.display='block'; listWrap.style.display='none'; },
      showList(){ ask.style.display='none'; listWrap.style.display='block'; calc(); },
      getSummary(){
        const items=[]; let total=0;
        inputs.forEach(({input,it})=>{
          const q = Math.max(0, parseInt(input.value||'0',10));
          if(q>0){ items.push({ key: it.key, nome: it.nome, qtd: q, preco: it.preco, subtotal: q*it.preco }); total += q*it.preco; }
        });
        return { items, total };
      }
    };

    // Eventos UI
    header.querySelector('.sc-x').addEventListener('click', ()=> api.close());
    ask.querySelector('[data-action="no"]').addEventListener('click', ()=>{
      api.close(); SecurityCellAddon._proceed();
    });
    ask.querySelector('[data-action="yes"]').addEventListener('click', ()=> api.showList());
    actions.querySelector('[data-action="back"]').addEventListener('click', ()=> api.showAsk());
    actions.querySelector('[data-action="continue"]').addEventListener('click', ()=>{
      const { total, items } = api.getSummary();
      // Dispara evento público
      window.dispatchEvent(new CustomEvent('securitycell:added', { detail: { total, items } }));
      // Anexa ao carrinho por padrão (personalizável)
      SecurityCellAddon._attach(total, items);
      api.close();
      SecurityCellAddon._proceed();
    });

    return api;
  }

  // API pública
  window.SecurityCellAddon = {
    _modal: null,
    _proceed: ()=>{},
    _attach: ()=>{},

    mount({ fecharSelector = '#fecharOrcamento', onProceed = null, onAttachToCart = null } = {}){
      injectCSS();
      this._modal = buildModal();
      document.body.appendChild(this._modalEl = document.createElement('div'));
      this._modalEl.appendChild(this._modalMask = document.querySelector('.sc-modal-mask'));

      // callbacks
      this._proceed = typeof onProceed === 'function' ? onProceed : () => {
        // fallback: tenta clicar no botão original novamente para seguir o fluxo nativo
        const btn = document.querySelector(fecharSelector);
        if(btn){
          // tenta evitar loop removendo nosso ouvinte temporariamente
          btn.removeEventListener('click', this._interceptor, true);
          btn.click();
          setTimeout(()=> btn.addEventListener('click', this._interceptor, true), 0);
        }
      };
      this._attach = typeof onAttachToCart === 'function' ? onAttachToCart : this.defaultAttach;

      // Intercepta o botão “Fechar orçamento”
      const btn = document.querySelector(fecharSelector);
      if(!btn){ console.warn('[SecurityCellAddon] Botão não encontrado em', fecharSelector); return; }

      // Guarda referência do handler para ligar/desligar
      this._interceptor = (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        this._modal.open(); this._modal.showAsk();
      };
      btn.addEventListener('click', this._interceptor, true);
    },

    // Estratégia padrão de anexar o item “célula de segurança” ao orçamento/proposta
    defaultAttach(total){
      if(!(total>0)) return; // nada a adicionar

      // 1) Se existir um objeto global de carrinho comum
      if(window.carrinho && Array.isArray(window.carrinho.itens)){
        window.carrinho.itens.push({
          id: 'CELULA_SEGURANCA',
          nome: 'Célula de segurança',
          quantidade: 1,
          precoUnitario: total,
          subtotal: total,
          meta: { tipo: 'bundle-security', origem: 'addon' }
        });
        if(typeof window.atualizarCarrinho === 'function') window.atualizarCarrinho();
        return;
      }

      // 2) Se houver localStorage com chave “orcamento” (objeto com itens)
      try{
        const raw = localStorage.getItem('orcamento');
        if(raw){
          const obj = JSON.parse(raw);
          if(obj && Array.isArray(obj.itens)){
            obj.itens.push({ id:'CELULA_SEGURANCA', nome:'Célula de segurança', qtd:1, preco: total, subtotal: total });
            localStorage.setItem('orcamento', JSON.stringify(obj));
            return;
          }
        }
      }catch(e){ /* ignora */ }

      // 3) Fallback: grava separado e deixa o front unir na geração da proposta
      localStorage.setItem('securitycell_total', String(total.toFixed(2)));
    }
  };
})();
