/*
 * Copyright (c) 2025, VectorCamp PC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

const X86_CPUS = {
    "AVX512": [
        "cascadelake", "cannonlake", "cooperlake", "icelake-server", "icelake-client",
        "tigerlake", "rocketlake", "sapphirerapids", "emeraldrapids", "graniterapids",
        "graniterapids-d", "diamondrapids", "znver4", "znver5", "znver6",
    ],
    "AVX2": [
        "haswell", "core-avx2", "broadwell", "skylake", "alderlake", "raptorlake", 
        "meteorlake", "gracemont", "arrowlake", "arrowlake-s", "lunarlake", 
        "pantherlake", "wildcatlake", "novalake", "sierraforest", "grandridge", 
        "clearwaterforest", "bdver4", "znver1", "znver2", "znver3"
    ],
    "AVX": [
        "sandybridge", "corei7-avx", "ivybridge", "core-avx-i", "bdver1", 
        "bdver2", "bdver3", "lujiazui"
    ],
    "SSE": [
        "x86-64", "x86-64-v2", "x86-64-v3", "x86-64-v4", "pentium3m", "pentium-m",
        "pentium4", "pentium4m", "prescott", "nocona", "core2", "nehalem", 
        "corei7", "westmere", "bonnell", "atom", "silvermont", "slm", "goldmont",
        "goldmont-plus", "tremont", "athlon", "athlon-tbird", "athlon-4", 
        "athlon-xp", "athlon-mp", "k8", "opteron", "athlon64", "athlon-fx",
        "k8-sse3", "opteron-sse3", "athlon64-sse3", "amdfam10", "barcelona",
        "btver1", "btver2", "c3-2", "c7", "nehemiah", "esther", "eden-x2",
        "nano", "nano-1000", "nano-2000", "nano-3000", "nano-x2", "nano-x4"
    ],
};

const ARM_CPUS = {
    "A32": ["cortex-a17", "cortex-a53"],
    "A64": [
        "cortex-a55", "cortex-a72", "cortex-a73", "cortex-a75", "cortex-a76",
        "cortex-a77", "cortex-a78", "cortex-x1", "cortex-x2", "cortex-x3",
        "cortex-a710", "cortex-a715", "neoverse-n1", "neoverse-n2", 
        "neoverse-v1", "neoverse-v2", "ampere1", "ampere1a", "ampere1b",
    ],
    "v7": ["cortex-a9", "cortex-a15"],
};

const POWER_CPUS = ["pwr8", "pwr9", "pwr10"];

interface CpuConfig {
    label: string;
    category: string;
    target?: string;
    mcpu?: string;
    march?: string;
    useNative?: boolean;
}

function generateCpuConfigs(): { [key: string]: CpuConfig } {
    const configs: { [key: string]: CpuConfig } = {};
    
    // Add native option
    configs['native'] = {
        label: 'Native (Auto-detect)',
        category: 'Native',
        useNative: true
    };
    
    // x86 CPUs - use -march instead of -mcpu
    for (const [category, cpus] of Object.entries(X86_CPUS)) {
        for (const cpu of cpus) {
            configs[`x86-${cpu}`] = {
                label: `${cpu}`,
                category: `x86-64 ${category}`,
                march: cpu,
                mcpu: cpu  // For MCA
            };
        }
    }
    
    // ARM CPUs - use -mcpu
    for (const [category, cpus] of Object.entries(ARM_CPUS)) {
        for (const cpu of cpus) {
            configs[`arm-${cpu}`] = {
                label: `${cpu}`,
                category: `ARM ${category}`,
                target: 'aarch64-linux-gnu',
                mcpu: cpu
            };
        }
    }
    
    // PowerPC CPUs - use -mcpu
    for (const cpu of POWER_CPUS) {
        configs[`power-${cpu}`] = {
            label: `${cpu}`,
            category: 'PowerPC',
            target: 'powerpc64le-linux-gnu',
            mcpu: cpu
        };
    }
    
    return configs;
}

const CPU_CONFIGS = generateCpuConfigs();

// Detect host architecture
async function getHostArch(): Promise<string> {
    try {
        const platform = os.platform();
        if (platform === 'darwin') {
            const { stdout } = await execAsync('uname -m');
            return stdout.trim();
        } else if (platform === 'linux') {
            const { stdout } = await execAsync('uname -m');
            return stdout.trim();
        }
        return os.arch();
    } catch (e) {
        return os.arch();
    }
}

function isCompatibleTarget(hostArch: string, targetConfig: CpuConfig): boolean {
    // Native is always compatible
    if (targetConfig.useNative) {return true;}
    
    // Check if host can compile for target
    if (hostArch.includes('x86_64') || hostArch.includes('amd64')) {
        // x86 host can only compile x86 targets
        return !targetConfig.target || targetConfig.target === '';
    } else if (hostArch.includes('aarch64') || hostArch.includes('arm64')) {
        // ARM host can compile ARM targets natively
        return !targetConfig.target || targetConfig.target.includes('aarch64');
    } else if (hostArch.includes('ppc64') || hostArch.includes('powerpc')) {
        // PowerPC host
        return !targetConfig.target || targetConfig.target.includes('powerpc');
    }
    
    // By default, only allow native compilation
    return !targetConfig.target;
}

interface McaResults {
    latency: string;
    throughput: string;
    fullReport: string;
    assembly: string;
    cpuTarget: string;
    instructions: Array<{
        order: number;
        uops: string;
        latency: string;
        throughput: string;
        instruction: string;
    }>;
}

async function analyzeMca(codeText: string, cpuKey: string): Promise<McaResults> {
    console.log('Starting MCA analysis...');
    
    const config = CPU_CONFIGS[cpuKey];
    if (!config) {
        throw new Error(`Unknown CPU: ${cpuKey}`);
    }
    
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llvm-mca-'));
    console.log('Temp dir:', tmpDir);
    
    const cFile = path.join(tmpDir, 'input.cpp');
    const asmFile = path.join(tmpDir, 'output.s');

    try {
        let headers = "";
        let compileFlags: string[] = [];
        
        const isCrossCompile = config.target && config.target !== 'native';

        if (isCrossCompile) {
            compileFlags.push('-ffreestanding');
            compileFlags.push('-nostdlibinc');
        } else {
            headers += `#include <stddef.h>\n#include <stdint.h>\n`;
        }

        // Architecture specific headers
        if (config.target?.includes('aarch64')) {
            headers += '#include <arm_neon.h>\n';
        } else if (config.target?.includes('powerpc')) {
            headers += '#include <altivec.h>\n';
        } else {
            headers += '#include <immintrin.h>\n';
        }

        headers += `
#ifndef uchar
typedef unsigned char uchar;
#endif
#ifndef uint
typedef unsigned int uint;
#endif
#ifndef ushort
typedef unsigned short ushort;
#endif
`;

        const codeToCompile = headers + codeText;

        await fs.writeFile(cFile, codeToCompile);
        console.log('Written C++ file with headers');

        // Build clang command
        const targetFlag = config.target ? `--target=${config.target}` : '';
        const compileFlagsStr = compileFlags.join(' ');
        
        let cpuFlag = '';
        if (config.useNative) {
            cpuFlag = '-march=native';
        } else if (config.march) {
            // x86 uses -march
            cpuFlag = `-march=${config.march}`;
        } else if (config.mcpu) {
            // ARM and PowerPC use -mcpu
            cpuFlag = `-mcpu=${config.mcpu}`;
        }
        
        const clangCmd = `clang -S -O2 ${targetFlag} ${cpuFlag} ${compileFlagsStr} -o ${asmFile} ${cFile}`;
        console.log('Running:', clangCmd);
        await execAsync(clangCmd);

        // Build MCA command - always use -mcpu for llvm-mca
        const mcpuForMca = config.mcpu || (config.useNative ? 'native' : config.march);
        const mcaCmd = `llvm-mca -mcpu=${mcpuForMca} ${asmFile}`;
        console.log('Running:', mcaCmd);
        const { stdout } = await execAsync(mcaCmd);

        const latencyMatch = stdout.match(/Total Cycles:\s+(\d+)/);
        const throughputMatch = stdout.match(/Block RThroughput:\s+([\d.]+)/);
        
        const latency = latencyMatch ? latencyMatch[1] : 'N/A';
        const throughput = throughputMatch ? throughputMatch[1] : 'N/A';

        const asmContent = await fs.readFile(asmFile, 'utf-8');

        // Parse instructions
        const instructions: Array<{order: number, uops: string, latency: string, throughput: string, instruction: string}> = [];
        const instrInfoMatch = stdout.match(/Instruction Info:[\s\S]*?\[1\]    \[2\]    \[3\].*?\n([\s\S]*?)(?=\n\nResources:|$)/);
        
        if (instrInfoMatch) {
            const lines = instrInfoMatch[1].trim().split('\n');
            let order = 1;
            for (const line of lines) {
                const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+.*?\s{2,}(.+)$/);
                if (match) {
                    instructions.push({
                        order: order++,
                        uops: match[1],
                        latency: match[2],
                        throughput: match[3],
                        instruction: match[4].trim()
                    });
                }
            }
        }

        return {
            latency,
            throughput,
            fullReport: stdout,
            assembly: asmContent,
            cpuTarget: `${config.category} - ${config.label}`,
            instructions
        };
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}

function getWebviewContent(results: McaResults): string {
    const instructionsJson = JSON.stringify(results.instructions);
    
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>LLVM-MCA Analysis</title>
        <style>
            body {
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                padding: 20px;
                line-height: 1.6;
            }
            h1 {
                color: #FFA500;
                border-bottom: 2px solid var(--vscode-panel-border);
                padding-bottom: 10px;
            }
            h2 {
                color: #FFA500;
                margin-top: 30px;
                margin-bottom: 15px;
            }
            .metrics {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin: 20px 0;
            }
            .metric {
                background: var(--vscode-editor-inactiveSelectionBackground);
                padding: 20px;
                border-radius: 8px;
                border-left: 4px solid #FFA500;
                position: relative;
                overflow: hidden;
            }
            .metric::before {
                content: '';
                position: absolute;
                top: 0;
                right: 0;
                width: 60px;
                height: 60px;
                background: #FFA500;
                opacity: 0.1;
                border-radius: 0 8px 0 100%;
            }
            .metric-label {
                font-size: 0.85em;
                opacity: 0.8;
                margin-bottom: 8px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .metric-value {
                font-size: 2.5em;
                font-weight: bold;
                color: #FFA500;
            }
            .metric-unit {
                font-size: 0.4em;
                opacity: 0.6;
                margin-left: 5px;
            }
            .arch-info {
                margin-top: 15px;
                padding: 15px;
                background: var(--vscode-editor-inactiveSelectionBackground);
                border-radius: 5px;
                border-left: 3px solid #FFA500;
            }
            .chart-container {
                background: var(--vscode-editor-inactiveSelectionBackground);
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin: 20px 0;
                background: var(--vscode-editor-background);
            }
            th {
                background: var(--vscode-editor-inactiveSelectionBackground);
                padding: 12px;
                text-align: left;
                font-weight: 600;
                border-bottom: 2px solid var(--vscode-panel-border);
                cursor: pointer;
                user-select: none;
                position: relative;
            }
            th:hover {
                background: var(--vscode-list-hoverBackground);
            }
            th.sortable::after {
                content: ' ⇅';
                opacity: 0.3;
                font-size: 0.8em;
            }
            th.sort-asc::after {
                content: ' ▲';
                opacity: 1;
            }
            th.sort-desc::after {
                content: ' ▼';
                opacity: 1;
            }
            td {
                padding: 10px 12px;
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            tr:hover {
                background: var(--vscode-list-hoverBackground);
            }
            .instruction {
                font-family: var(--vscode-editor-font-family);
                font-size: 0.95em;
                color: var(--vscode-editor-foreground);
            }
            .bar-cell {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .bar {
                height: 20px;
                background: linear-gradient(90deg, #FFA500, #FF8C00);
                border-radius: 3px;
                transition: width 0.3s ease;
            }
            .bar-value {
                min-width: 30px;
                text-align: right;
            }
            pre {
                background: var(--vscode-textCodeBlock-background);
                padding: 15px;
                border-radius: 5px;
                overflow-x: auto;
                border: 1px solid var(--vscode-panel-border);
            }
            code {
                font-family: var(--vscode-editor-font-family);
                font-size: 0.9em;
            }
            .section {
                margin-bottom: 30px;
            }
            details {
                margin-top: 20px;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 5px;
                padding: 10px;
            }
            summary {
                cursor: pointer;
                font-weight: 600;
                padding: 10px;
                user-select: none;
            }
            summary:hover {
                background: var(--vscode-list-hoverBackground);
            }
            canvas {
                max-width: 100%;
                height: 200px;
            }
            .controls {
                margin-bottom: 15px;
                display: flex;
                gap: 10px;
            }
            .btn {
                background: #FFA500;
                color: #fff;
                border: none;
                padding: 8px 16px;
                border-radius: 5px;
                cursor: pointer;
                font-family: var(--vscode-font-family);
                font-size: 0.9em;
                transition: background 0.2s;
            }
            .btn:hover {
                background: #FF8C00;
            }
            .btn.active {
                background: #FF8C00;
                box-shadow: 0 0 0 2px #FFA500;
            }
        </style>
    </head>
    <body>
        <h1> LLVM-MCA Analysis Results</h1>
        
        <div class="section">
            <div class="metrics">
                <div class="metric">
                    <div class="metric-label">Total Cycles</div>
                    <div class="metric-value">${results.latency}<span class="metric-unit">cycles</span></div>
                </div>
                <div class="metric">
                    <div class="metric-label">Block Throughput</div>
                    <div class="metric-value">${results.throughput}<span class="metric-unit">cycles</span></div>
                </div>
                <div class="metric">
                    <div class="metric-label">Instructions</div>
                    <div class="metric-value">${results.instructions.length}<span class="metric-unit">total</span></div>
                </div>
            </div>
            <div class="arch-info">
                <strong> CPU Target:</strong> ${escapeHtml(results.cpuTarget)}
            </div>
        </div>

        <div class="section">
            <h2> Performance Visualization</h2>
            <div class="chart-container">
                <canvas id="perfChart"></canvas>
            </div>
        </div>

        <div class="section">
            <h2> Instruction Performance (click headers to sort)</h2>
            <div class="controls">
                <button class="btn active" id="resetBtn"> Assembly Order</button>
            </div>
            <table id="instrTable">
                <thead>
                    <tr>
                        <th class="sortable" data-column="order">#</th>
                        <th class="sortable" data-column="uops">uOps</th>
                        <th class="sortable" data-column="latency">Latency</th>
                        <th class="sortable" data-column="throughput">Throughput</th>
                        <th class="sortable" data-column="instruction">Instruction</th>
                    </tr>
                </thead>
                <tbody id="tableBody">
                </tbody>
            </table>
        </div>

        <div class="section">
            <details>
                <summary> Generated Assembly Code</summary>
                <pre><code>${escapeHtml(results.assembly)}</code></pre>
            </details>
        </div>

        <div class="section">
            <details>
                <summary> Full MCA Report</summary>
                <pre><code>${escapeHtml(results.fullReport)}</code></pre>
            </details>
        </div>

        <script>
            const instructions = ${instructionsJson};
            const originalOrder = JSON.parse(JSON.stringify(instructions));
            let currentSort = { column: null, direction: 'asc' };

            function renderTable() {
                const tbody = document.getElementById('tableBody');
                tbody.innerHTML = '';
                
                const maxLatency = Math.max(...instructions.map(i => parseFloat(i.latency)));
                const maxThroughput = Math.max(...instructions.map(i => parseFloat(i.throughput)));
                
                instructions.forEach(instr => {
                    const row = document.createElement('tr');
                    
                    const latencyPercent = (parseFloat(instr.latency) / maxLatency) * 100;
                    const throughputPercent = (parseFloat(instr.throughput) / maxThroughput) * 100;
                    
                    row.innerHTML = \`
                        <td>\${instr.order}</td>
                        <td>\${instr.uops}</td>
                        <td>
                            <div class="bar-cell">
                                <div class="bar" style="width: \${latencyPercent}%"></div>
                                <span class="bar-value">\${instr.latency}</span>
                            </div>
                        </td>
                        <td>
                            <div class="bar-cell">
                                <div class="bar" style="width: \${throughputPercent}%"></div>
                                <span class="bar-value">\${instr.throughput}</span>
                            </div>
                        </td>
                        <td class="instruction">\${escapeHtml(instr.instruction)}</td>
                    \`;
                    tbody.appendChild(row);
                });
            }

            function sortTable(column) {
                if (currentSort.column === column) {
                    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.column = column;
                    currentSort.direction = 'asc';
                }

                instructions.sort((a, b) => {
                    let valA = a[column];
                    let valB = b[column];
                    
                    if (column !== 'instruction') {
                        valA = parseFloat(valA);
                        valB = parseFloat(valB);
                    }
                    
                    if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
                    if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
                    return 0;
                });

                document.querySelectorAll('th').forEach(th => {
                    th.classList.remove('sort-asc', 'sort-desc');
                    if (th.dataset.column === column) {
                        th.classList.add('sort-' + currentSort.direction);
                    }
                });

                document.getElementById('resetBtn').classList.remove('active');
                renderTable();
            }

            function resetToAssemblyOrder() {
                instructions.length = 0;
                instructions.push(...originalOrder);
                
                currentSort = { column: null, direction: 'asc' };
                
                document.querySelectorAll('th').forEach(th => {
                    th.classList.remove('sort-asc', 'sort-desc');
                });
                
                document.getElementById('resetBtn').classList.add('active');
                renderTable();
            }

            document.querySelectorAll('th.sortable').forEach(th => {
                th.addEventListener('click', () => sortTable(th.dataset.column));
            });

            document.getElementById('resetBtn').addEventListener('click', resetToAssemblyOrder);

            function escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            function drawChart() {
                const canvas = document.getElementById('perfChart');
                const ctx = canvas.getContext('2d');
                const dpr = window.devicePixelRatio || 1;
                
                canvas.width = canvas.offsetWidth * dpr;
                canvas.height = canvas.offsetHeight * dpr;
                ctx.scale(dpr, dpr);
                
                const width = canvas.offsetWidth;
                const height = canvas.offsetHeight;
                const padding = 40;
                const barWidth = Math.min(60, (width - padding * 2) / (instructions.length * 2));
                const maxValue = Math.max(
                    ...instructions.map(i => Math.max(parseFloat(i.latency), parseFloat(i.throughput)))
                );

                ctx.clearRect(0, 0, width, height);
                
                instructions.forEach((instr, i) => {
                    const x = padding + i * barWidth * 2;
                    const latHeight = (parseFloat(instr.latency) / maxValue) * (height - padding * 2);
                    const tputHeight = (parseFloat(instr.throughput) / maxValue) * (height - padding * 2);
                    
                    ctx.fillStyle = 'rgba(100, 149, 237, 0.7)';
                    ctx.fillRect(x, height - padding - latHeight, barWidth * 0.45, latHeight);
                    
                    ctx.fillStyle = 'rgba(255, 140, 0, 0.7)';
                    ctx.fillRect(x + barWidth * 0.5, height - padding - tputHeight, barWidth * 0.45, tputHeight);
                });
                
                ctx.font = '12px sans-serif';
                ctx.fillStyle = 'rgba(100, 149, 237, 0.7)';
                ctx.fillRect(width - 150, 10, 15, 15);
                ctx.fillStyle = getComputedStyle(document.body).color;
                ctx.fillText('Latency', width - 130, 22);
                
                ctx.fillStyle = 'rgba(255, 140, 0, 0.7)';
                ctx.fillRect(width - 150, 30, 15, 15);
                ctx.fillStyle = getComputedStyle(document.body).color;
                ctx.fillText('Throughput', width - 130, 42);
            }

            renderTable();
            drawChart();
        </script>
    </body>
    </html>`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function registerLlvmMcaCommand(context: vscode.ExtensionContext) {
    console.log('Registering LLVM-MCA command...');
    
    const disposable = vscode.commands.registerCommand('code.simd.ai.analyzeMca', async () => {
        console.log('LLVM-MCA command triggered!');
        
        const editor = vscode.window.activeTextEditor;
        
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        const selection = editor.selection;
        const text = editor.document.getText(selection);

        if (!text.trim()) {
            vscode.window.showErrorMessage('No code selected');
            return;
        }

        // Detect host architecture
        const hostArch = await getHostArch();
        console.log('Host architecture:', hostArch);

        // Filter CPUs by compatibility
        const cpuItems = Object.entries(CPU_CONFIGS)
            .filter(([key, config]) => isCompatibleTarget(hostArch, config))
            .map(([key, config]) => ({
                label: config.label,
                description: config.category,
                key: key
            }));

        if (cpuItems.length === 0) {
            vscode.window.showErrorMessage('No compatible CPU targets found for your system');
            return;
        }

        // Sort by category then label
        cpuItems.sort((a, b) => {
            if (a.description === b.description) {
                return a.label.localeCompare(b.label);
            }
            return a.description.localeCompare(b.description);
        });

        const selectedCpu = await vscode.window.showQuickPick(cpuItems, {
            placeHolder: 'Select CPU target for analysis',
            title: 'LLVM-MCA CPU Target',
            matchOnDescription: true
        });

        if (!selectedCpu) {
            return; // User cancelled
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Analyzing with LLVM-MCA (${selectedCpu.label})`,
                cancellable: false
            }, async (progress) => {
                progress.report({ message: "Compiling to assembly..." });
                
                const results = await analyzeMca(text, selectedCpu.key);

                progress.report({ message: "Generating report..." });

                // Create webview panel
                const panel = vscode.window.createWebviewPanel(
                    'llvmMcaResults',
                    `LLVM-MCA - ${selectedCpu.label}`,
                    vscode.ViewColumn.Beside,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true
                    }
                );

                panel.webview.html = getWebviewContent(results);

                vscode.window.showInformationMessage(
                    `Analysis complete! Latency: ${results.latency} cycles | Throughput: ${results.throughput}`
                );
                
                console.log('Analysis complete!');
            });

        } catch (error: any) {
            console.error('Command error:', error);
            vscode.window.showErrorMessage(`LLVM-MCA Error: ${error.message}`);
        }
    });

    context.subscriptions.push(disposable);
    console.log('LLVM-MCA command registered successfully');
}