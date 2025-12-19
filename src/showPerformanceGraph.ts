import * as vscode from 'vscode';
import { simdFullData } from './intrinsicsCache';


function normalizeIntrinsicData(data: any) {
  const prototypes: any[] = [];

  // top-level prototypes
  if (data.prototypes && data.prototypes.length) {
    for (const p of data.prototypes) {
      prototypes.push({
        key: p.key || data.name,
        output: p.output || '',
        inputs: p.inputs || [],
        asm: p.asm || data.asm || 'N/A',
        syntax: p.syntax || data.syntax || 'N/A',
        example: p.example || '<em>No example available</em>',
        llvm_mca: p.llvm_mca || p.llvm_mca_neon || {},
      });
    }
  } 
  // IBM / VSX
  else if (data.architectures && data.architectures.length) {
    for (const arch of data.architectures) {
      if (arch.prototypes && arch.prototypes.length) {
        for (const p of arch.prototypes) {
          prototypes.push({
            key: p.key || arch.name,
            output: p.output || '',
            inputs: p.inputs || [],
            asm: p.asm || arch.asm || 'N/A',
            syntax: p.syntax || arch.syntax || 'N/A',
            example: p.example || '<em>No example available</em>',
            llvm_mca: p.llvm_mca || {},
          });
        }
      }
    }
  } 
  // single top-level prototype
  else {
    prototypes.push({
      key: data.name,
      output: data.output || '',
      inputs: data.inputs || [],
      asm: data.asm || 'N/A',
      syntax: data.syntax || 'N/A',
      example: data.example || '<em>No example available</em>',
      llvm_mca: data.llvm_mca || {},
    });
  }

  return prototypes;
}




export function registerShowPerformanceGraphCommand(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('code.simd.ai.showPerformanceGraph', async (idOrArgs) => {
    
    const lookupKey = typeof idOrArgs === 'string' ? idOrArgs : null;
    if (!lookupKey) {
      vscode.window.showErrorMessage('Invalid performance data key.');
      return;
    }
    
    const args = simdFullData[lookupKey];
    if (!args) {
      vscode.window.showErrorMessage(`No performance data available for: ${lookupKey}`);
      return;
    }

    const { key, simd, llvm_mca, llvm_mca_neon, tooltip } = args;

    let perfData =
      llvm_mca_neon ||
      (llvm_mca ? Object.entries(llvm_mca).map(([cpu, v]) => ({ cpu, ...(v as any) })) : []);

    if (!perfData.length) {
      vscode.window.showWarningMessage(`No valid performance entries for ${key || 'intrinsic'}.`);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'simdPerformance',
      `Performance Graph - ${key || 'Intrinsic'}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    const makeTableRows = (data: any[]) =>
      data
        .map(
          (p: any) =>
            `<tr>
              <td>${p.cpu}</td>
              <td>${p.latency}</td>
              <td>${p.throughput}</td>
            </tr>`
        )
        .join('\n');

    const tooltipHtml = tooltip
      ? tooltip
          .replace(/\*\*Prototypes:\*\*[\s\S]*/g, '')
          .replace(/### \[([^\]]+)\]\(([^\)]+)\)([^\n]*)/g,
            '<h3><a href="$2" style="color: #FFA500; text-decoration: none;">$1</a>$3</h3>'
          )
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/```c\n([\s\S]*?)\n```/g, '<pre><code>$1</code></pre>')
          .replace(/\*([^*]+)\*/g, '<em>$1</em>')
          .replace(/\n\n/g, '</p><p>')
          .replace(/\n/g, '<br>')
          .replace(/^(.+)$/, '<p>$1</p>')
      : '<p>No tooltip available</p>';

    panel.webview.html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 1.5rem; background-color: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-editor-foreground, #cccccc); line-height: 1.6; }
            h2,h3 { margin-bottom:1rem; color: var(--vscode-editor-foreground,#ccc);}
            a { color:#FFA500; text-decoration:none; }
            a:hover { text-decoration:underline; }
            .tooltip-section { background-color: rgba(255,165,0,0.08); border-left: 4px solid #FFA500; padding: 1.25rem; margin-bottom: 2rem; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);}
            .tooltip-section h3 { margin-top:0;margin-bottom:0.75rem; color:#FFA500;font-size:1.2em; }
            .tooltip-section p { margin:0.5rem 0; }
            .tooltip-section pre { background-color: rgba(0,0,0,0.4); padding:0.75rem; border-radius:4px; overflow-x:auto; margin:0.75rem 0; border:1px solid rgba(255,165,0,0.2);}
            .tooltip-section code { font-family:'Consolas','Monaco','Courier New',monospace; font-size:0.9em;color:#e0e0e0;}
            .tooltip-section strong { color:#FF8C00; font-weight:600; }
            .tooltip-section em { color:#aaa; font-style:italic; }
            .performance-section { margin-top:2rem; }
            canvas { width:100%; max-height:420px; margin-bottom:1.5rem; background-color: rgba(0,0,0,0.2); border-radius:8px; padding:1rem; }
            table { width:100%; border-collapse:collapse; margin-top:1rem; font-size:0.9rem; }
            th, td { border:1px solid rgba(255,255,255,0.1); padding:8px 12px; text-align:center; }
            th { cursor:pointer; user-select:none; background: linear-gradient(90deg,#FFA500,#FF8C00,#FF4500); -webkit-background-clip:text; -webkit-text-fill-color:transparent; transition:filter 0.3s ease; font-weight:600; }
            th:hover { filter:brightness(1.3); }
            tr:nth-child(even) { background-color: rgba(255,255,255,0.04);}
            tr:hover { background-color: rgba(255,165,0,0.1); }
            .tooltip-header { display:flex; justify-content:space-between; align-items:center; cursor:pointer; font-weight:600; color:#FFA500; user-select:none; }
            .tooltip-header:hover { filter:brightness(1.2);}
            .tooltip-content { margin-top:0.75rem;}

            .prototype-card {
              border: 1px solid rgba(255,165,0,0.2);
              border-radius: 6px;
              padding: 0.75rem;
              margin-top: 0.75rem;
              background-color: rgba(0,0,0,0.25);
            }

            .prototype-header {
              display: flex;
              justify-content: space-between;
              cursor: pointer;
              user-select: none;
              color: #FFA500;
              font-weight: 600;
            }

            .prototype-header:hover {
              filter: brightness(1.2);
            }

            .prototype-body {
              margin-top: 0.75rem;
            }

            .prototype-body p {
              margin: 0.4rem 0;
            }

            .chevron {
              margin-left: 0.5rem;
            }
          </style>
        </head>
        <body>
          <div class="tooltip-section">
            <div class="tooltip-header" id="tooltipToggle">
              <span>Intrinsic Description</span>
              <span id="tooltipChevron">▸</span>
            </div>
            <div class="tooltip-content" id="tooltipContent" hidden>
              ${tooltipHtml}
              ${normalizeIntrinsicData(args).map((p, idx) => {
                const inputsStr = p.inputs?.join(', ') || '';
                const asmStr = Array.isArray(p.asm) ? p.asm.join(', ') : p.asm || 'N/A';
                const syntaxStr = p.syntax || 'N/A';
                const exampleStr = p.example
                  ? `<pre><code>${p.example.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code></pre>`
                  : '<pre><em>No example available</em></pre>';

                const protoId = `proto_${idx}`;

                return `
                  <div class="prototype-card">
                    <div class="prototype-header" data-target="${protoId}">
                      <span>
                        <strong>Prototype:</strong>
                        ${p.output || 'void'} result = ${p.key}(${inputsStr});
                      </span>
                      <span class="chevron">▸</span>
                    </div>

                    <div class="prototype-body" id="${protoId}" hidden>
                      <p><strong>ASM:</strong> ${asmStr}</p>
                      <p><strong>Syntax:</strong> ${syntaxStr}</p>
                      <p><strong>Example:</strong></p>
                      ${exampleStr}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <div class="performance-section">
            <h2>${key || ''} ${simd ? `(${simd})` : ''} - Performance Metrics</h2>
            <canvas id="chart"></canvas>
            <h3>llvm_mca metrics (click headers to sort)</h3>
            <table id="perfTable">
              <thead>
                <tr>
                  <th data-key="cpu">CPU</th>
                  <th data-key="latency">Latency (Cycles)</th>
                  <th data-key="throughput">Throughput (IPC)</th>
                </tr>
              </thead>
              <tbody>
                ${makeTableRows(perfData)}
              </tbody>
            </table>
          </div>

          <script>
            let perfData = ${JSON.stringify(perfData)};
            const ctx = document.getElementById('chart').getContext('2d');
            const latencyGradient = ctx.createLinearGradient(0,0,0,400);
            latencyGradient.addColorStop(0,'#FF9999'); latencyGradient.addColorStop(0.5,'#FF4C4C'); latencyGradient.addColorStop(1,'#CC0000');
            const throughputGradient = ctx.createLinearGradient(0,0,0,400);
            throughputGradient.addColorStop(0,'#99CCFF'); throughputGradient.addColorStop(0.5,'#3399FF'); throughputGradient.addColorStop(1,'#0066CC');
            let chart = new Chart(ctx,{type:'bar',data:{labels:perfData.map(p=>p.cpu),datasets:[{label:'Latency (Cycles)',data:perfData.map(p=>p.latency),backgroundColor:latencyGradient,borderRadius:6},{label:'Throughput (IPC)',data:perfData.map(p=>p.throughput),backgroundColor:throughputGradient,borderRadius:6}]},options:{responsive:true,plugins:{legend:{labels:{color:getComputedStyle(document.body).getPropertyValue('--vscode-editor-foreground')||'#ccc',font:{size:12}}}},scales:{x:{ticks:{color:getComputedStyle(document.body).getPropertyValue('--vscode-editor-foreground')||'#ccc'},grid:{color:'rgba(255,255,255,0.1)'}},y:{beginAtZero:true,title:{display:true,text:'Cycles',color:getComputedStyle(document.body).getPropertyValue('--vscode-editor-foreground')||'#ccc'},ticks:{color:getComputedStyle(document.body).getPropertyValue('--vscode-editor-foreground')||'#ccc'},grid:{color:'rgba(255,255,255,0.1)'}}}}});

            const table = document.getElementById('perfTable');
            let currentSort = { key:null, asc:true };
            function updateChart(){ chart.data.labels=perfData.map(p=>p.cpu); chart.data.datasets[0].data=perfData.map(p=>p.latency); chart.data.datasets[1].data=perfData.map(p=>p.throughput); chart.update(); }
            function updateTable(){ const tbody=table.querySelector('tbody'); tbody.innerHTML=perfData.map(p=>'<tr><td>'+p.cpu+'</td><td>'+p.latency+'</td><td>'+p.throughput+'</td></tr>').join(''); }
            table.querySelectorAll('th').forEach(th=>{ th.addEventListener('click',()=>{ const key=th.dataset.key; const asc=currentSort.key===key?!currentSort.asc:true; currentSort={key,asc}; perfData.sort((a,b)=>{ const va=a[key],vb=b[key],na=parseFloat(va),nb=parseFloat(vb); if(!isNaN(na)&&!isNaN(nb)) return asc?na-nb:nb-na; return asc?va.localeCompare(vb):vb.localeCompare(va); }); updateTable(); updateChart(); }); });

            const toggle=document.getElementById('tooltipToggle');
            const content=document.getElementById('tooltipContent');
            const chevron=document.getElementById('tooltipChevron');
            toggle.addEventListener('click',()=>{ const isHidden=content.hasAttribute('hidden'); if(isHidden){ content.removeAttribute('hidden'); chevron.textContent='▾'; } else { content.setAttribute('hidden',''); chevron.textContent='▸'; } });
            document.querySelectorAll('.prototype-header').forEach(header => {
              header.addEventListener('click', () => {
                const targetId = header.dataset.target;
                const body = document.getElementById(targetId);
                const chevron = header.querySelector('.chevron');

                const isHidden = body.hasAttribute('hidden');
                if (isHidden) {
                  body.removeAttribute('hidden');
                  chevron.textContent = '▾';
                } else {
                  body.setAttribute('hidden', '');
                  chevron.textContent = '▸';
                }
              });
            });
            </script>
        </body>
      </html>`;
  });

  context.subscriptions.push(disposable);
}
