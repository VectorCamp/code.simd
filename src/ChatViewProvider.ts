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
import { getChatWebviewHtml } from './ChatWebviewHtml';
import { getChatHistory, saveChatHistory, clearChatHistory, getAllSessions } from './utils/history';
import { extractMessages } from './utils/messageParser';
import { callSimdAiWithHistory } from './api/simdAi';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'code_simd_ai_chatView';
  private _view?: vscode.WebviewView;

  private currentSessionId: string = 'Chat 1';

  constructor(private readonly context: vscode.ExtensionContext) {}

  public postMessageToChat(text: string) {
    this._view?.webview.postMessage({ command: 'insertUserMessage', text });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    const webview = webviewView.webview;
    webview.options = { enableScripts: true };
    webview.html = getChatWebviewHtml(this.context, webview);

    webview.onDidReceiveMessage(async message => {
      switch (message.type) {
        case 'send':
          await this.handleUserMessage(message.text);
          break;
        case 'requestHistory':
          webview.postMessage({ type: 'history', messages: getChatHistory(this.context, this.currentSessionId) , sessionId: this.currentSessionId });
          break;
        case 'clearHistory':
          await clearChatHistory(this.context, this.currentSessionId);
          webview.postMessage({ type: 'history', messages: [], sessionId: this.currentSessionId });
          break;
        case 'switchSession':
          this.currentSessionId = message.sessionId;
          webview.postMessage({ type: 'history', messages: getChatHistory(this.context, this.currentSessionId) , sessionId: this.currentSessionId });
          break;
        case 'deleteSession':
            await clearChatHistory(this.context, message.sessionId);
            break;
        case 'requestSessionList':
            const sessions = Object.keys(getAllSessions(this.context));
            webview.postMessage({
                type: 'sessionList',
                sessions,
                currentSession: this.currentSessionId
            });
            break;
      }
    });
  }


  private async handleUserMessage(userText: string) {
    const webview = this._view?.webview;
    if (!webview) {return;}

    const sessionId = this.currentSessionId;  
    const rawHistory = getChatHistory(this.context, sessionId);
    const contextMessages = extractMessages(rawHistory);
    contextMessages.push({ role: 'user', content: userText });

    webview.postMessage({ type: 'responsePending', sessionId });

    try {
      const reply = await callSimdAiWithHistory(contextMessages);
      await saveChatHistory(this.context, sessionId, userText, reply);

      //  send reply back to the same session, even if user switched
      webview.postMessage({ type: 'response', text: reply, sessionId });
    } catch (err: any) {
      webview.postMessage({ type: 'responseError', error: String(err), sessionId });
    }
  }
}
