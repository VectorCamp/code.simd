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
import { ChatViewProvider } from './ChatViewProvider';
import * as fs from 'fs';
import * as path from 'path';


import { translationState, clearState } from './translation/state';
import { registerTranslateCommand } from './translation/translator';
import { registerAcceptRejectCommands, registerEditSIMDCommand } from './translation/commands';
import { TranslationCodeLensProvider } from './translation/codelens';
import { highlightIntrinsicsAndDatatypes, initIntrinsicHighlighting, deactivateHighlighting, cycleHighlightMode } from './syntaxHighlighting';
import { activate as activateCompletion } from './completionProvider';

import { registerShowPerformanceGraphCommand } from './showPerformanceGraph';

export function activate(context: vscode.ExtensionContext) {

	console.log('Extension "code.simd.info" is now active!');
	
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ scheme: 'file', language: '*' }, new TranslationCodeLensProvider())
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('code.simd.ai.cycleHighlightMode', () => {
			cycleHighlightMode(context);
		})
	);
	initIntrinsicHighlighting(context);
	vscode.window.visibleTextEditors.forEach(editor => {
        highlightIntrinsicsAndDatatypes(editor);
    });

	activateCompletion(context);
	
	registerShowPerformanceGraphCommand(context);
}

export function deactivate() {
	deactivateHighlighting();	
}
