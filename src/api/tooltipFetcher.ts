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

import fetch from 'node-fetch';
(globalThis as any).fetch = fetch;

import * as vscode from 'vscode';
import { fetchIntrinsicInfo } from './simdAi';
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Dev only — allow self-signed certs

const tooltipCache: Record<string, vscode.MarkdownString> = {};

export async function fetchTooltip(word: string): Promise<vscode.MarkdownString> {
  if (tooltipCache[word]) {return tooltipCache[word];}

  try {
    const data = await fetchIntrinsicInfo(word);
    if (!data) {
      console.warn(`No tooltip found for "${word}"`);
      return new vscode.MarkdownString(`No tooltip found for "${word}"`);
    }
    
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = { enabledCommands: ['code.simd.ai.showPerformanceGraph'] };
    md.supportHtml = true;
   
    // Handle new structure with multiple architectures
    if (Array.isArray(data.architectures) && data.architectures.length > 0) {
      for (const arch of data.architectures) {
        const { simd, architecture, purpose, prototypes = [], link_to_doc } = arch;
        const simdLink = `https://simd.info/c_intrinsic/${encodeURIComponent(data.name)}?engine=${simd}`;
        const titleLine = [`**${simd || ''}**`, architecture || ''].filter(Boolean).join(' - ');
        md.appendMarkdown(`### [${data.name}](${simdLink})${titleLine ? ` (${titleLine})` : ''}\n`);

        const plainPurpose = purpose?.replace(/<\/?[^>]+(>|$)/g, '').trim();
        if (plainPurpose) {
          md.appendMarkdown(`${plainPurpose}\n`);
        }

        if (prototypes.length) {
          md.appendMarkdown(`\n**Prototypes:**\n`);
          for (const proto of prototypes) {
            const inputList = proto.inputs?.join(', ') || '';
            const line = `${proto.output || 'void'} result = ${proto.key}(${inputList});`;
            md.appendMarkdown('```c\n' + line + '\n```\n');

            addViewPerformanceData(md, proto, simd);
          }
        }
      }
    } else {
      const simdLink = `https://simd.info/c_intrinsic/${encodeURIComponent(data.name)}?engine=${data.engine || ''}`;
      
      
      const simdInfo = [data.simd, data.engine].filter(Boolean).join(' : ');
      md.appendMarkdown(`### [${data.name}](${simdLink})${simdInfo ? ` (${simdInfo})` : ''}\n`);
      if (simdInfo) {md.appendMarkdown(`(${simdInfo})\n`);}

      const purpose = data.purpose?.replace(/<\/?[^>]+(>|$)/g, '').trim();
      if (purpose) {md.appendMarkdown(`${purpose}\n`);}

      if (data.notes?.trim()) {
        md.appendMarkdown(`**Notes:** ${data.notes.trim()}\n`);
      }

      if (Array.isArray(data.prototypes) && data.prototypes.length > 0) {
        md.appendMarkdown(`\n**Prototypes:**\n`);
        for (const proto of data.prototypes) {
          const inputList = proto.inputs?.join(', ') || '';
          const line = `${proto.output || 'void'} result = ${proto.key}(${inputList});`;
          md.appendMarkdown('```c\n' + line + '\n```\n');
          
          addViewPerformanceData(md, proto, data.simd || data.engine);
        }
      }
    }

    tooltipCache[word] = md;
    return md;
  } catch (error) {
    console.error('Failed to fetch tooltip for', word, error);
    return new vscode.MarkdownString(`Failed to fetch tooltip for "${word}"`);
  }
}


import { fetchDatatypesByArch } from './datatypeFetcher';

const datatypeTooltipCache: Record<string, string> = {};

export async function fetchDatatypeTooltip(name: string): Promise<string> {
  return ''; // Coming soon datatype tooltips
  if (datatypeTooltipCache[name]) {return datatypeTooltipCache[name];}

  try {
    const datatypesByArch = await fetchDatatypesByArch();
    if (!datatypesByArch || !Object.keys(datatypesByArch).length) {
      console.warn('No datatypes available');
      return '';
    }

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    let found = false;
    for (const [arch, names] of Object.entries(datatypesByArch)) {
      if (names.includes(name)) {
        found = true;
        const link = `https://simd.info/datatype/${encodeURIComponent(name)}`;
        md.appendMarkdown(`### [${name}](${link}) (${arch})\n`);
        md.appendMarkdown(`Description for ${name} on ${arch}.\n`); 
      }
    }

    if (!found) {
      md.appendMarkdown(`No datatype info found for **${name}**`);
    }

    const markdown = md.value;
    datatypeTooltipCache[name] = markdown;
    return markdown;
  } catch (error) {
    console.error('Failed to fetch datatype tooltip for', name, error);
    return '';
  }
}

function addViewPerformanceData(
  md: vscode.MarkdownString, 
  proto: any, 
  simd?: string
): void {
  const hasGraphData =
  (proto.llvm_mca && Object.keys(proto.llvm_mca).length > 0) ||
  (proto.llvm_mca_neon && proto.llvm_mca_neon.length > 0);

  const isSequence =
  typeof proto.asm === 'string' && proto.asm.trim().toLowerCase() === 'sequence' ||
  typeof proto.syntax === 'string' && proto.syntax.trim().toLowerCase() === 'sequence';

  if (hasGraphData) {
    const args = {
      key: proto.key,
      simd,
      llvm_mca: proto.llvm_mca,
      llvm_mca_neon: proto.llvm_mca_neon
    };
    const encodedArgs = encodeURIComponent(JSON.stringify(args));
    md.appendMarkdown(
      `\n*→ [Show Latency/Throughput](command:code.simd.ai.showPerformanceGraph?${encodedArgs})*\n`
    );
  } else if (isSequence) {
    md.appendMarkdown(
      `\n*Latency/Throughput information is not available for this intrinsic as it does not map to a single instruction.*\n`
    );
  } else {
    md.appendMarkdown(
      `\n*Latency/Throughput data unavailable for this intrinsic.*\n`
    );
  }
}